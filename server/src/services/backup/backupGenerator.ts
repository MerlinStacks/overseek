/**
 * BackupGenerator - Generate account data backups
 * 
 * Handles collecting and packaging account data for backup.
 * Streams large tables in batches to avoid OOM issues.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import type { AccountBackup, BackupOptions } from './types';
import { BACKUP_VERSION, SENSITIVE_ACCOUNT_FIELDS } from './constants';

/**
 * Generate full account backup
 */
export async function generateBackup(
    accountId: string,
    options: BackupOptions = {}
): Promise<AccountBackup | null> {
    const { includeAuditLogs = false, includeAnalytics = false } = options;

    Logger.info('[AccountBackup] Starting backup generation', { accountId, options });
    const startTime = Date.now();

    // Fetch account record
    const account = await prisma.account.findUnique({
        where: { id: accountId },
    });

    if (!account) {
        Logger.warn('[AccountBackup] Account not found', { accountId });
        return null;
    }

    // Strip sensitive fields from account
    const sanitizedAccount = sanitizeAccount(account as Record<string, unknown>);

    // Fetch all related data in parallel batches
    const data: Record<string, unknown[]> = {};

    // Users (with user details, excluding passwordHash)
    data.users = await prisma.accountUser.findMany({
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
    });

    // Roles
    data.roles = await prisma.accountRole.findMany({
        where: { accountId },
    });

    // Features
    data.features = await prisma.accountFeature.findMany({
        where: { accountId },
    });

    // Products with variations
    data.products = await prisma.wooProduct.findMany({
        where: { accountId },
        include: { variations: true },
    });

    // Orders (batch to avoid memory issues)
    data.orders = await fetchInBatches(
        (skip, take) =>
            prisma.wooOrder.findMany({
                where: { accountId },
                skip,
                take,
                orderBy: { dateCreated: 'desc' },
            }),
        5000
    );

    // Customers
    data.customers = await prisma.wooCustomer.findMany({
        where: { accountId },
    });

    // Reviews
    data.reviews = await prisma.wooReview.findMany({
        where: { accountId },
    });

    // Suppliers with items
    data.suppliers = await prisma.supplier.findMany({
        where: { accountId },
        include: { items: true },
    });

    // Internal Products
    data.internalProducts = await prisma.internalProduct.findMany({
        where: { accountId },
    });

    // BOMs with items
    data.boms = await prisma.bOM.findMany({
        where: { product: { accountId } },
        include: { items: true },
    });

    // Purchase Orders with items
    data.purchaseOrders = await prisma.purchaseOrder.findMany({
        where: { accountId },
        include: { items: true },
    });

    // Conversations with messages
    data.conversations = await prisma.conversation.findMany({
        where: { accountId },
        include: {
            messages: {
                orderBy: { createdAt: 'asc' },
            },
        },
    });

    // Canned responses
    data.cannedResponses = await prisma.cannedResponse.findMany({
        where: { accountId },
    });

    // Email accounts (mask credentials)
    const emailAccounts = await prisma.emailAccount.findMany({
        where: { accountId },
    });
    data.emailAccounts = emailAccounts.map((ea) => ({
        ...ea,
        password: '********', // Mask password
    }));

    // Email templates
    data.emailTemplates = await prisma.emailTemplate.findMany({
        where: { accountId },
    });

    // Marketing automations with steps
    data.automations = await prisma.marketingAutomation.findMany({
        where: { accountId },
        include: { steps: true },
    });

    // Campaigns
    data.campaigns = await prisma.marketingCampaign.findMany({
        where: { accountId },
    });

    // Segments
    data.segments = await prisma.customerSegment.findMany({
        where: { accountId },
    });

    // Invoice templates
    data.invoiceTemplates = await prisma.invoiceTemplate.findMany({
        where: { accountId },
    });

    // Policies
    data.policies = await prisma.policy.findMany({
        where: { accountId },
    });

    // Dashboards with widgets
    data.dashboards = await prisma.dashboardLayout.findMany({
        where: { accountId },
        include: { widgets: true },
    });

    // Sync states
    data.syncStates = await prisma.syncState.findMany({
        where: { accountId },
    });

    // Ad accounts (mask tokens)
    const adAccounts = await prisma.adAccount.findMany({
        where: { accountId },
    });
    data.adAccounts = adAccounts.map((aa) => ({
        ...aa,
        accessToken: '********',
        refreshToken: aa.refreshToken ? '********' : null,
    }));

    // Social accounts (mask tokens)
    const socialAccounts = await prisma.socialAccount.findMany({
        where: { accountId },
    });
    data.socialAccounts = socialAccounts.map((sa) => ({
        ...sa,
        accessToken: '********',
        refreshToken: sa.refreshToken ? '********' : null,
        webhookSecret: sa.webhookSecret ? '********' : null,
    }));

    // Optional: Audit logs
    if (includeAuditLogs) {
        data.auditLogs = await fetchInBatches(
            (skip, take) =>
                prisma.auditLog.findMany({
                    where: { accountId },
                    skip,
                    take,
                    orderBy: { createdAt: 'desc' },
                }),
            5000
        );
    }

    // Optional: Analytics sessions
    if (includeAnalytics) {
        data.analyticsSessions = await prisma.analyticsSession.findMany({
            where: { accountId },
            include: { events: true },
        });
    }

    const elapsedMs = Date.now() - startTime;
    Logger.info('[AccountBackup] Backup generation complete', {
        accountId,
        elapsedMs,
        recordCount: Object.values(data).flat().length,
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
    const sanitized = { ...account };
    for (const field of SENSITIVE_ACCOUNT_FIELDS) {
        if (field in sanitized) {
            sanitized[field] = '********';
        }
    }
    return sanitized;
}

/**
 * Fetch large tables in batches to avoid OOM
 */
async function fetchInBatches<T>(
    fetchFn: (skip: number, take: number) => Promise<T[]>,
    batchSize: number = 5000
): Promise<T[]> {
    const results: T[] = [];
    let skip = 0;
    let batch: T[];

    do {
        batch = await fetchFn(skip, batchSize);
        results.push(...batch);
        skip += batchSize;
    } while (batch.length === batchSize);

    return results;
}
