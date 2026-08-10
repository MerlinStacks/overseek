import fs from 'fs';
import path from 'path';
import { prisma } from '../../utils/prisma';
import { getDefaultEmailAccount } from '../../utils/getDefaultEmailAccount';
import { EmailService } from '../EmailService';
import { QueueFactory, QUEUES } from '../queue/QueueFactory';
import { AuditActions, AuditService } from '../AuditService';
import { assertPrivateSharePath } from './storage';
import { deriveShareStatus, generatedPassword, hashPassword, randomToken, sha256, validateCustomPassword, validateShareExpiry } from './shareSecurity';

function customerSnapshot(customer: any) {
    const raw = customer.rawData && typeof customer.rawData === 'object' ? customer.rawData : {};
    const billing = raw.billing && typeof raw.billing === 'object' ? raw.billing : {};
    const company = String(billing.company || raw.company || `${customer.firstName || ''} ${customer.lastName || ''}`).trim();
    const contact = String(`${billing.first_name || customer.firstName || ''} ${billing.last_name || customer.lastName || ''}`).trim();
    return { company, contact, email: String(billing.email || customer.email).trim(), phone: String(billing.phone || '').trim() };
}

function safeShare(share: any) {
    const { tokenHash, passwordHash, personalizedPdfPath, personalizedPagesPath, ...result } = share;
    return { ...result, status: deriveShareStatus(share) };
}

export function withNotificationPreference(snapshot: unknown, muted: boolean) {
    const value = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
    return { ...value, notificationsMuted: muted };
}

export class WholesaleShareService {
    static customerSnapshot = customerSnapshot;

    static async searchCustomers(accountId: string, query: string) {
        const q = query.trim();
        if (!q) return [];
        const rows = await (prisma as any).$queryRawUnsafe(
            `SELECT id, email, "firstName", "lastName", "rawData" FROM "WooCustomer" WHERE "accountId" = $1 AND (email ILIKE $2 OR COALESCE("firstName", '') ILIKE $2 OR COALESCE("lastName", '') ILIKE $2 OR "rawData"::text ILIKE $2) ORDER BY "updatedAt" DESC LIMIT 50`,
            accountId, `%${q}%`,
        );
        return rows.map((customer: any) => ({ id: customer.id, ...customerSnapshot(customer) }));
    }

    static async prepare(accountId: string, userId: string, generationId: string, customerId: string, expiry: string) {
        if (!await getDefaultEmailAccount(accountId)) throw new Error('A default outbound email account is required');
        const [generation, customer, defaults] = await Promise.all([
            (prisma as any).wholesaleCatalogGeneration.findFirst({ where: { id: generationId, accountId }, include: { catalog: true } }),
            (prisma as any).wooCustomer.findFirst({ where: { id: customerId, accountId } }),
            (prisma as any).wholesaleCatalogDefaults.findUnique({ where: { accountId } }),
        ]);
        if (!generation || generation.status !== 'APPROVED' || generation.staleAt || generation.validUntil <= new Date() || generation.validityArtifactStatus !== 'CURRENT') throw new Error('Generation must be approved, current and non-stale');
        if (generation.catalog.status === 'ARCHIVED') throw new Error('Archived catalogs cannot be shared');
        if (!customer) throw new Error('Customer not found');
        if (!defaults) throw new Error('Wholesale defaults are required');
        const createdAt = new Date();
        const expiresAt = validateShareExpiry(expiry, createdAt);
        const confidentialityText = defaults.confidentialityNotice || 'Confidential. For the intended recipient only.';
        const share = await (prisma as any).wholesaleCatalogShare.create({ data: {
            accountId, catalogId: generation.catalogId, generationId, customerId, createdById: userId,
            customerSnapshot: customerSnapshot(customer), expiresAt, artifactStatus: 'QUEUED',
            confidentialityTextSnapshot: confidentialityText, confidentialityHash: sha256(confidentialityText),
            privacyNoticeSnapshot: defaults.privacyNotice || 'Viewer details are recorded to protect this confidential catalog.',
        } });
        try {
            await QueueFactory.getQueue(QUEUES.WHOLESALE_CATALOG_SHARE_PREPARE).add('prepare-wholesale-catalog-share', { shareId: share.id, accountId }, { jobId: `wholesale-share-${share.id}`, attempts: 1 });
        } catch (error) {
            await (prisma as any).wholesaleCatalogShare.update({ where: { id: share.id }, data: { artifactStatus: 'FAILED', artifactError: 'Unable to queue share preparation' } });
            throw error;
        }
        return safeShare(share);
    }

    static async get(accountId: string, shareId: string) {
        const share = await (prisma as any).wholesaleCatalogShare.findFirst({ where: { id: shareId, accountId } });
        if (!share) throw new Error('Share not found');
        return share;
    }

    static async list(accountId: string, catalogId: string) {
        return (await (prisma as any).wholesaleCatalogShare.findMany({ where: { accountId, catalogId }, orderBy: { createdAt: 'desc' } })).map(safeShare);
    }

    static async detail(accountId: string, shareId: string, includeViewers = false) {
        const share = await this.get(accountId, shareId);
        const [viewers, sessions, logs] = await Promise.all([
            (prisma as any).wholesaleCatalogViewer.findMany({ where: { shareId }, orderBy: { createdAt: 'desc' } }),
            (prisma as any).wholesaleCatalogViewerSession.findMany({ where: { shareId }, select: { id: true, viewerId: true, deviceSummary: true } }),
            (prisma as any).wholesaleCatalogAccessLog.findMany({ where: { shareId, eventType: 'PAGE_VIEW', success: true, isScanner: false }, select: { viewerId: true, sessionId: true, pageNumber: true, createdAt: true } }),
        ]);
        const uniquePages = new Set(logs.map((log: any) => log.pageNumber).filter(Boolean));
        const analyticsViewerIds = new Set(logs.map((log: any) => log.viewerId).filter(Boolean));
        const analyticsSessionIds = new Set(logs.map((log: any) => log.sessionId).filter(Boolean));
        const pageCount = Number((share.customerSnapshot as any)?.pageCount || 0);
        const analyticsSessions = sessions.filter((session: any) => analyticsSessionIds.has(session.id));
        return { share: safeShare(share), summary: { uniquePages: uniquePages.size, completion: pageCount ? Math.round(uniquePages.size / pageCount * 100) : 0, lastPage: Math.max(0, ...logs.map((log: any) => log.pageNumber || 0)), viewerCount: analyticsViewerIds.size, deviceCount: new Set(analyticsSessions.map((session: any) => session.deviceSummary).filter(Boolean)).size, sessionCount: analyticsSessions.length }, ...(includeViewers ? { viewers } : {}) };
    }

    static async activate(accountId: string, userId: string, shareId: string, input: { password?: string; subject?: string; introduction?: string }) {
        const observed = await this.get(accountId, shareId);
        const password = input.password ? validateCustomPassword(input.password) : generatedPassword();
        const token = randomToken();
        const url = `${(process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')}/catalog-view/${token}`;
        const emailAccount = await getDefaultEmailAccount(accountId);
        if (!emailAccount) throw new Error('A default outbound email account is required');
        const passwordHash = await hashPassword(password);
        const tokenHash = sha256(token);
        const claimedAt = new Date();
        const activation = await (prisma as any).$transaction(async (tx: any) => {
            await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `wholesale-share:${shareId}`);
            const share = await tx.wholesaleCatalogShare.findFirst({
                where: { id: shareId, accountId }, include: { generation: true, catalog: { select: { publicTitle: true, status: true } } },
            });
            if (!share || share.updatedAt.getTime() !== observed.updatedAt.getTime()) throw new Error('Share activation changed; retry the resend');
            const now = new Date();
            if (share.artifactStatus !== 'READY' || share.revokedAt || share.expiresAt <= now) throw new Error('Share is not ready');
            if (share.lockedUntil && share.failedAttempts === 0 && share.lockedUntil > now) throw new Error('A share email is already being sent');
            if (share.generation.status !== 'APPROVED' || share.generation.staleAt || share.generation.validUntil <= now || share.generation.validityArtifactStatus !== 'CURRENT') throw new Error('Generation must be approved, current and non-stale');
            if (share.catalog.status === 'ARCHIVED') throw new Error('Archived catalogs cannot be shared');
            const customer = share.customerSnapshot as any;
            const subject = (input.subject || `[Catalog] prepared for [Company]`).replaceAll('[Catalog]', share.catalog.publicTitle || 'Wholesale catalog').replaceAll('[Company]', customer.company);
            const introduction = (input.introduction || '[Catalog] prepared for [Company]').replaceAll('[Catalog]', share.catalog.publicTitle || 'Wholesale catalog').replaceAll('[Company]', customer.company);
            await tx.wholesaleCatalogViewerSession.updateMany({ where: { shareId, revokedAt: null }, data: { revokedAt: new Date() } });
            await tx.wholesaleCatalogShare.update({ where: { id: shareId }, data: {
                tokenHash, passwordHash, activatedAt: claimedAt, emailedAt: claimedAt,
                failedAttempts: 0, lockedUntil: new Date(claimedAt.getTime() + 60_000),
            } });
            return { resend: !!share.activatedAt, subject, introduction, customer, expiresAt: share.expiresAt };
        }, { maxWait: 5000, timeout: 30000 });

        const html = `<div style="font-family:Arial,sans-serif;max-width:620px"><h1>${escapeHtml(activation.subject)}</h1><p>${escapeHtml(activation.introduction)}</p><p><a href="${escapeHtml(url)}" style="background:#18202a;color:#fff;padding:12px 18px;text-decoration:none">View secure catalog</a></p><p>Link: ${escapeHtml(url)}</p><p>Password: <strong>${escapeHtml(password)}</strong></p><p>This link expires ${activation.expiresAt.toISOString()}.</p></div>`;
        try {
            // Provider timeouts can be ambiguous (accepted but reported failed). We
            // intentionally clear this exact claim so any possibly delivered link is inactive.
            const result = await new EmailService().sendEmail(accountId, emailAccount.id, activation.customer.email, activation.subject, html, undefined, { source: 'WHOLESALE_CATALOG_SHARE', sourceId: shareId, category: 'TRANSACTIONAL' });
            if ((result as any)?.skipped) throw new Error('Catalog email was not sent');
        } catch (error) {
            await (prisma as any).wholesaleCatalogShare.updateMany({
                where: { id: shareId, accountId, tokenHash, passwordHash, activatedAt: claimedAt },
                data: { tokenHash: null, passwordHash: null, activatedAt: null, emailedAt: null, lockedUntil: null },
            });
            throw error;
        }
        await AuditService.log(accountId, userId, AuditActions.WHOLESALE_SHARE_ACTIVATED, 'WHOLESALE_CATALOG_SHARE', shareId, { resend: activation.resend });
        return { url, password };
    }

    static resend(accountId: string, userId: string, shareId: string, input: { password?: string; subject?: string; introduction?: string }) {
        return this.activate(accountId, userId, shareId, input);
    }

    static async rotatePassword(accountId: string, userId: string, shareId: string, input: { password?: string }) {
        const password = input.password ? validateCustomPassword(input.password) : generatedPassword();
        const token = randomToken();
        const passwordHash = await hashPassword(password);
        const tokenHash = sha256(token);
        await (prisma as any).$transaction(async (tx: any) => {
            await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `wholesale-share:${shareId}`);
            const share = await tx.wholesaleCatalogShare.findFirst({ where: { id: shareId, accountId } });
            const now = new Date();
            if (!share || share.artifactStatus !== 'READY' || !share.activatedAt || share.revokedAt || share.expiresAt <= now) throw new Error('Share is not active');
            await tx.wholesaleCatalogViewerSession.updateMany({ where: { shareId, revokedAt: null }, data: { revokedAt: now } });
            await tx.wholesaleCatalogShare.update({ where: { id: shareId }, data: { tokenHash, passwordHash, failedAttempts: 0, lockedUntil: null } });
        }, { maxWait: 5000, timeout: 30000 });
        await AuditService.log(accountId, userId, AuditActions.WHOLESALE_SHARE_ACTIVATED, 'WHOLESALE_CATALOG_SHARE', shareId, { passwordRotation: true, emailed: false });
        const url = `${(process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')}/catalog-view/${token}`;
        return { url, password };
    }

    static async setNotificationsMuted(accountId: string, shareId: string, muted: boolean) {
        const share = await this.get(accountId, shareId);
        const customerSnapshot = withNotificationPreference(share.customerSnapshot, muted);
        const changed = await (prisma as any).wholesaleCatalogShare.updateMany({
            where: { id: shareId, accountId },
            data: { customerSnapshot },
        });
        if (!changed.count) throw new Error('Share not found');
        return safeShare({ ...share, customerSnapshot });
    }

    static async revoke(accountId: string, userId: string, shareId: string) {
        await this.get(accountId, shareId);
        await (prisma as any).$transaction([(prisma as any).wholesaleCatalogShare.update({ where: { id: shareId }, data: { revokedAt: new Date() } }), (prisma as any).wholesaleCatalogViewerSession.updateMany({ where: { shareId, revokedAt: null }, data: { revokedAt: new Date() } })]);
        await AuditService.log(accountId, userId, AuditActions.WHOLESALE_SHARE_REVOKED, 'WHOLESALE_CATALOG_SHARE', shareId, {});
    }

    static async changeExpiry(accountId: string, userId: string, shareId: string, value: string) {
        const share = await this.get(accountId, shareId);
        const expiresAt = validateShareExpiry(value, share.createdAt);
        await (prisma as any).wholesaleCatalogShare.update({ where: { id: shareId }, data: { expiresAt } });
        if (expiresAt <= new Date()) await (prisma as any).wholesaleCatalogViewerSession.updateMany({ where: { shareId }, data: { revokedAt: new Date() } });
        await AuditService.log(accountId, userId, AuditActions.WHOLESALE_SHARE_EXPIRY_CHANGED, 'WHOLESALE_CATALOG_SHARE', shareId, { expiresAt });
        return expiresAt;
    }

    static async readablePdf(accountId: string, shareId: string) {
        const share = await this.get(accountId, shareId);
        if (share.artifactStatus !== 'READY' || !share.personalizedPdfPath) throw new Error('Share PDF is unavailable');
        const filePath = assertPrivateSharePath(share.personalizedPdfPath, share.id);
        await fs.promises.access(filePath, fs.constants.R_OK);
        return { share, filePath, fileName: path.basename(share.personalizedFileName || 'catalog.pdf') };
    }
}

function escapeHtml(value: unknown) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
