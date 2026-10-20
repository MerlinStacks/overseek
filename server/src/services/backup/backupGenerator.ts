/**
 * BackupGenerator - Generate account data backups
 * 
 * Handles collecting and packaging account data for backup.
 * Reads a consistent snapshot in bounded batches. The legacy API still returns
 * one materialized object, so a serialized-size budget guards oversized exports.
 */

import { prisma } from '../../utils/prisma';
import { Prisma } from '@prisma/client';
import { Logger } from '../../utils/logger';
import type { AccountBackup, BackupOptions } from './types';
import { BACKUP_VERSION, BACKUP_LIMITS, SENSITIVE_ACCOUNT_FIELDS, SENSITIVE_EMAIL_FIELDS } from './constants';

/**
 * Generate full account backup
 */
export async function generateBackup(
    accountId: string,
    options: BackupOptions = {}
): Promise<AccountBackup | null> {
    if (typeof accountId !== 'string' || !accountId.trim()) throw new Error('Account ID required');
    return prisma.$transaction(tx => generateBackupSnapshot(tx, accountId, options), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: BACKUP_LIMITS.transactionTimeoutMs,
    });
}

async function generateBackupSnapshot(db: Prisma.TransactionClient, accountId: string, options: BackupOptions): Promise<AccountBackup | null> {
    const { includeAuditLogs = false, includeAnalytics = false } = options;

    Logger.info('[AccountBackup] Starting backup generation', { accountId, options });
    const startTime = Date.now();

    // Fetch account record
    const account = await db.account.findUnique({
        where: { id: accountId },
    });

    if (!account) {
        Logger.warn('[AccountBackup] Account not found', { accountId });
        return null;
    }

    // Strip sensitive fields from account
    const sanitizedAccount = sanitizeAccount(account as Record<string, unknown>);

    let serializedBytes = 0;
    function consume(value: unknown) {
        serializedBytes += Buffer.byteLength(JSON.stringify(value), 'utf8') + 1;
        if (serializedBytes > BACKUP_LIMITS.maxSerializedBytes) {
            throw new Error('Backup exceeds the in-memory export size limit (100 MiB). Export a smaller scope or use a database backup.');
        }
    }
    consume(sanitizedAccount);
    async function load<T extends { id: string }>(
        fetchPage: (page: BackupPage) => Promise<T[]>,
        sanitize: (row: T) => unknown = row => row,
    ): Promise<unknown[]> {
        const rows: unknown[] = [];
        let cursor: string | undefined;
        while (true) {
            const batch = await fetchPage({ take: BACKUP_LIMITS.batchSize, orderBy: { id: 'asc' },
                ...(cursor ? { cursor: { id: cursor }, skip: 1 as const } : {}) });
            for (const row of batch) {
                const safeRow = sanitize(row);
                consume(safeRow);
                rows.push(safeRow);
            }
            if (batch.length < BACKUP_LIMITS.batchSize) return rows;
            cursor = batch[batch.length - 1].id;
        }
    }

    // Every collection is paginated within the same repeatable-read snapshot.
    const data: Record<string, unknown[]> = {};

    // Users (with user details, excluding passwordHash)
    data.users = await load(page => db.accountUser.findMany({
        ...page,
        where: { accountId },
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    fullName: true,
                    avatarUrl: true,
                    shiftStart: true,
                    shiftEnd: true,
                    createdAt: true,
                },
            },
        },
    }));

    // Roles
    data.roles = await load(page => db.accountRole.findMany({ ...page, where: { accountId } }));

    // Features
    data.features = await load(page => db.accountFeature.findMany({ ...page, where: { accountId } }));

    // Products with variations
    data.products = await load(page => db.wooProduct.findMany({
        ...page,
        where: { accountId },
        include: { variations: { orderBy: { id: 'asc' } } },
    }));

    // Orders (batch to avoid memory issues)
    data.orders = await load(page => db.wooOrder.findMany({ ...page, where: { accountId }, orderBy: [{ dateCreated: 'desc' }, { id: 'asc' }] }));

    // Customers
    data.customers = await load(page => db.wooCustomer.findMany({ ...page, where: { accountId } }));

    // Reviews
    data.reviews = await load(page => db.wooReview.findMany({ ...page, where: { accountId } }));

    // Suppliers with items
    data.suppliers = await load(page => db.supplier.findMany({
        ...page,
        where: { accountId },
        include: { items: true },
    }));

    // Internal Products
    data.internalProducts = await load(page => db.internalProduct.findMany({ ...page, where: { accountId } }));

    // BOMs with items
    data.boms = await load(page => db.bOM.findMany({
        ...page,
        where: { product: { accountId } },
        include: { items: true },
    }));

    // Purchase Orders with items
    data.purchaseOrders = await load(page => db.purchaseOrder.findMany({
        ...page,
        where: { accountId },
        include: { items: true },
    }));

    // Conversations with messages
    data.conversations = await load(page => db.conversation.findMany({
        ...page,
        where: { accountId },
        include: {
            messages: {
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            },
        },
    }));

    // Canned responses
    data.cannedResponses = await load(page => db.cannedResponse.findMany({ ...page, where: { accountId } }));

    // Email accounts (mask credentials)
    data.emailAccounts = await load(page => db.emailAccount.findMany({ ...page, where: { accountId } }),
        ea => redactFields({ ...ea, password: '********' }, SENSITIVE_EMAIL_FIELDS));

    // Email templates
    data.emailTemplates = await load(page => db.emailTemplate.findMany({ ...page, where: { accountId } }));

    // Marketing automations with steps
    data.automations = await load(page => db.marketingAutomation.findMany({
        ...page,
        where: { accountId },
        include: { steps: true },
    }));

    // Campaigns
    data.campaigns = await load(page => db.marketingCampaign.findMany({ ...page, where: { accountId } }));

    // Segments
    data.segments = await load(page => db.customerSegment.findMany({ ...page, where: { accountId } }));

    // Invoice templates
    data.invoiceTemplates = await load(page => db.invoiceTemplate.findMany({ ...page, where: { accountId } }));

    // Policies
    data.policies = await load(page => db.policy.findMany({ ...page, where: { accountId } }));

    // Dashboards with widgets
    data.dashboards = await load(page => db.dashboardLayout.findMany({
        ...page,
        where: { accountId },
        include: { widgets: true },
    }));

    // Sync states
    data.syncStates = await load(page => db.syncState.findMany({ ...page, where: { accountId } }));

    // Ad accounts (mask tokens)
    data.adAccounts = await load(page => db.adAccount.findMany({ ...page, where: { accountId } }), aa => ({
        ...aa,
        accessToken: '********',
        refreshToken: aa.refreshToken ? '********' : null,
    }));

    // Social accounts (mask tokens)
    data.socialAccounts = await load(page => db.socialAccount.findMany({ ...page, where: { accountId } }), sa => ({
        ...sa,
        accessToken: '********',
        refreshToken: sa.refreshToken ? '********' : null,
        webhookSecret: sa.webhookSecret ? '********' : null,
    }));

    // Optional: Audit logs
    if (includeAuditLogs) {
        data.auditLogs = await load(page => db.auditLog.findMany({ ...page, where: { accountId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }));
    }

    // Optional: Analytics sessions
    if (includeAnalytics) {
        data.analyticsSessions = await load(page => db.analyticsSession.findMany({
            ...page,
            where: { accountId },
            include: { events: true },
        }));
    }

    const elapsedMs = Date.now() - startTime;
    Logger.info('[AccountBackup] Backup generation complete', {
        accountId,
        elapsedMs,
        recordCount: Object.values(data).reduce((sum, rows) => sum + rows.length, 0),
    });

    return {
        exportedAt: new Date().toISOString(),
        version: BACKUP_VERSION,
        account: sanitizedAccount,
        data,
    };
}

/**
 * Generate a preview of backup contents with record counts
 */
export async function getBackupPreview(accountId: string) {
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { id: true, name: true },
    });

    if (!account) return null;

    // Count records for each entity type
    const [
        users,
        features,
        products,
        variations,
        orders,
        customers,
        reviews,
        suppliers,
        supplierItems,
        boms,
        bomItems,
        purchaseOrders,
        conversations,
        messages,
        cannedResponses,
        emailAccounts,
        emailTemplates,
        automations,
        campaigns,
        segments,
        invoiceTemplates,
        policies,
        dashboards,
        syncStates,
        auditLogs,
        internalProducts,
        roles,
        adAccounts,
        socialAccounts,
    ] = await Promise.all([
        prisma.accountUser.count({ where: { accountId } }),
        prisma.accountFeature.count({ where: { accountId } }),
        prisma.wooProduct.count({ where: { accountId } }),
        prisma.productVariation.count({ where: { product: { accountId } } }),
        prisma.wooOrder.count({ where: { accountId } }),
        prisma.wooCustomer.count({ where: { accountId } }),
        prisma.wooReview.count({ where: { accountId } }),
        prisma.supplier.count({ where: { accountId } }),
        prisma.supplierItem.count({ where: { supplier: { accountId } } }),
        prisma.bOM.count({ where: { product: { accountId } } }),
        prisma.bOMItem.count({ where: { bom: { product: { accountId } } } }),
        prisma.purchaseOrder.count({ where: { accountId } }),
        prisma.conversation.count({ where: { accountId } }),
        prisma.message.count({ where: { conversation: { accountId } } }),
        prisma.cannedResponse.count({ where: { accountId } }),
        prisma.emailAccount.count({ where: { accountId } }),
        prisma.emailTemplate.count({ where: { accountId } }),
        prisma.marketingAutomation.count({ where: { accountId } }),
        prisma.marketingCampaign.count({ where: { accountId } }),
        prisma.customerSegment.count({ where: { accountId } }),
        prisma.invoiceTemplate.count({ where: { accountId } }),
        prisma.policy.count({ where: { accountId } }),
        prisma.dashboardLayout.count({ where: { accountId } }),
        prisma.syncState.count({ where: { accountId } }),
        prisma.auditLog.count({ where: { accountId } }),
        prisma.internalProduct.count({ where: { accountId } }),
        prisma.accountRole.count({ where: { accountId } }),
        prisma.adAccount.count({ where: { accountId } }),
        prisma.socialAccount.count({ where: { accountId } }),
    ]);

    const recordCounts: Record<string, number> = {
        users,
        features,
        products,
        variations,
        orders,
        customers,
        reviews,
        suppliers,
        supplierItems,
        boms,
        bomItems,
        purchaseOrders,
        conversations,
        messages,
        cannedResponses,
        emailAccounts,
        emailTemplates,
        automations,
        campaigns,
        segments,
        invoiceTemplates,
        policies,
        dashboards,
        syncStates,
        auditLogs,
        internalProducts,
        roles,
        adAccounts,
        socialAccounts,
    };

    // Rough size estimate (avg ~500 bytes per record)
    const totalRecords = Object.values(recordCounts).reduce((a, b) => a + b, 0);
    const estimatedSizeKB = Math.round(totalRecords * 0.5);

    return {
        accountId: account.id,
        accountName: account.name,
        recordCounts,
        estimatedSizeKB,
    };
}

/**
 * Remove sensitive fields from account object
 */
function sanitizeAccount(account: Record<string, unknown>): Record<string, unknown> {
    return redactFields(account, SENSITIVE_ACCOUNT_FIELDS);
}

function redactFields(account: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
    const sanitized = { ...account };
    for (const field of fields) {
        if (field in sanitized) {
            sanitized[field] = '********';
        }
    }
    return sanitized;
}

interface BackupPage {
    take: number;
    orderBy: { id: 'asc' };
    cursor?: { id: string };
    skip?: 1;
}
