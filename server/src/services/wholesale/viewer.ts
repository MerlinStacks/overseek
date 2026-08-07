import fs from 'fs';
import path from 'path';
import { prisma } from '../../utils/prisma';
import { isAccountFeatureEnabled } from '../../utils/accountFeatures';
import { Logger } from '../../utils/logger';
import { AuditActions, AuditService } from '../AuditService';
import { EmailService } from '../EmailService';
import { getDefaultEmailAccount } from '../../utils/getDefaultEmailAccount';
import { assertPrivateSharePath } from './storage';
import { lockoutAfterFailure, randomToken, sha256, verifyPassword, watermarkSvg } from './shareSecurity';

export const VIEWER_COOKIE = 'overseek_catalog_session';

function truncatedIp(ip: string) {
    if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':');
    const parts = ip.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : ip.slice(0, 45);
}

function requestContext(request: any) {
    const ua = String(request.headers['user-agent'] || '').slice(0, 500);
    return { ipAddress: truncatedIp(String(request.ip || '')), userAgent: ua, deviceSummary: ua.slice(0, 120), isScanner: isKnownScanner(ua) };
}

const SCANNER_UA = /(?:googleimageproxy|googlebot|bingbot|microsoft office existence discovery|safelinks|urlscan|proofpoint|barracuda|mimecast|symantec|messagelabs|fireeye|zscaler|facebookexternalhit|slackbot|discordbot|twitterbot|linkedinbot|whatsapp|telegrambot|skypeuripreview)/i;
export function isKnownScanner(userAgent: string) { return SCANNER_UA.test(String(userAgent || '')); }
export function areViewerNotificationsMuted(share: { customerSnapshot?: unknown }) {
    const snapshot = share.customerSnapshot;
    return !!(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && (snapshot as any).notificationsMuted === true);
}

export function parseCookies(header: unknown): Record<string, string> {
    const result: Record<string, string> = {};
    for (const part of String(header || '').split(';')) {
        const index = part.indexOf('=');
        if (index <= 0) continue;
        try { result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* Ignore malformed cookies. */ }
    }
    return result;
}

async function activeShare(rawToken: string) {
    const share = await (prisma as any).wholesaleCatalogShare.findUnique({ where: { tokenHash: sha256(rawToken) }, include: { catalog: { select: { publicTitle: true } }, generation: { select: { validUntil: true } }, createdBy: { select: { email: true } } } });
    if (!share || !await isAccountFeatureEnabled(share.accountId, 'WHOLESALE_CATALOG', false) || !share.activatedAt || share.revokedAt || share.expiresAt <= new Date() || share.artifactStatus !== 'READY' || !share.passwordHash || !share.personalizedPagesPath) throw new Error('Unavailable');
    return share;
}

async function sessionFor(request: any, share: any) {
    const raw = parseCookies(request.headers.cookie)[VIEWER_COOKIE];
    if (!raw) throw new Error('Unavailable');
    const session = await (prisma as any).wholesaleCatalogViewerSession.findUnique({ where: { tokenHash: sha256(raw) }, include: { viewer: true } });
    if (!session || session.shareId !== share.id || session.revokedAt || session.expiresAt <= new Date()) throw new Error('Unavailable');
    await (prisma as any).wholesaleCatalogViewerSession.update({ where: { id: session.id }, data: { lastActivityAt: new Date() } });
    return session;
}

export class WholesaleViewerService {
    static activeShare = activeShare;

    static async prompt(rawToken: string) {
        const share = await activeShare(rawToken);
        return { title: share.catalog.publicTitle, requiresPassword: true, privacyNotice: share.privacyNoticeSnapshot, expiresAt: share.expiresAt, expiredPricing: share.generation.validUntil <= new Date() };
    }

    static async unlock(rawToken: string, password: string, request: any) {
        const share = await activeShare(rawToken);
        const now = new Date();
        if (share.lockedUntil && share.failedAttempts !== 0 && share.lockedUntil > now) throw new Error('Unavailable');
        const valid = await verifyPassword(share.passwordHash, password).catch(() => false);
        const context = requestContext(request);
        if (!valid) {
            const failed = await (prisma as any).wholesaleCatalogShare.update({ where: { id: share.id }, data: { failedAttempts: { increment: 1 } }, select: { failedAttempts: true } });
            if (failed.failedAttempts >= 5) await (prisma as any).wholesaleCatalogShare.update({ where: { id: share.id }, data: lockoutAfterFailure(failed.failedAttempts, now) });
            await this.log(share, null, null, 'UNLOCK', false, context);
            throw new Error('Unavailable');
        }
        const rawSession = randomToken();
        const expiresAt = new Date(Math.min(share.expiresAt.getTime(), now.getTime() + 24 * 60 * 60 * 1000));
        const { isScanner: _isScanner, ...sessionContext } = context;
        const session = await (prisma as any).wholesaleCatalogViewerSession.create({ data: { accountId: share.accountId, shareId: share.id, tokenHash: sha256(rawSession), expiresAt, ...sessionContext } });
        await (prisma as any).wholesaleCatalogShare.update({ where: { id: share.id }, data: { failedAttempts: 0, lockedUntil: null } });
        await this.log(share, null, session.id, 'UNLOCK', true, context);
        return { rawSession, expiresAt, privacyNotice: share.privacyNoticeSnapshot };
    }

    static async identify(rawToken: string, request: any, name: string, email: string) {
        const share = await activeShare(rawToken);
        const session = await sessionFor(request, share);
        const viewer = await (prisma as any).wholesaleCatalogViewer.upsert({ where: { shareId_email: { shareId: share.id, email: email.toLowerCase() } }, update: { name }, create: { accountId: share.accountId, shareId: share.id, name, email: email.toLowerCase() } });
        await (prisma as any).wholesaleCatalogViewerSession.update({ where: { id: session.id }, data: { viewerId: viewer.id } });
        if (!viewer.notifiedAt) {
            const claimed = await (prisma as any).wholesaleCatalogViewer.updateMany({ where: { id: viewer.id, notifiedAt: null }, data: { notifiedAt: new Date() } });
            if (claimed.count && !areViewerNotificationsMuted(share)) {
                try { await (prisma as any).notification.create({ data: { accountId: share.accountId, title: 'New wholesale catalog viewer', message: 'A viewer identified themselves on a protected wholesale catalog.', type: 'INFO', link: `/wholesale-catalog/${share.catalogId}` } }); }
                catch (error) { Logger.warn('[WholesaleViewer] New viewer notification failed', { shareId: share.id, error }); }
                void this.emailCreator(share, `wholesale-viewer-new:${viewer.id}`, 'New wholesale catalog viewer', `<p>${escapeHtml(viewer.name)} (${escapeHtml(viewer.email)}) identified themselves on ${escapeHtml(share.catalog.publicTitle)}.</p>`);
            }
        }
        return { privacyNotice: share.privacyNoticeSnapshot, confidentialityText: share.confidentialityTextSnapshot };
    }

    static async accept(rawToken: string, request: any) {
        const share = await activeShare(rawToken);
        const session = await sessionFor(request, share);
        if (!session.viewer) throw new Error('Unavailable');
        const context = requestContext(request);
        await (prisma as any).wholesaleCatalogViewer.update({ where: { id: session.viewer.id }, data: { confidentialityAcceptedAt: new Date(), acceptedConfidentialityText: share.confidentialityTextSnapshot, acceptedConfidentialityHash: share.confidentialityHash } });
        await this.log(share, session.viewer.id, session.id, 'CONFIDENTIALITY_ACCEPTED', true, context, { confidentialityHash: share.confidentialityHash });
    }

    static async pages(rawToken: string, request: any) {
        const { share, session } = await this.accepted(rawToken, request);
        return { pageCount: Number((share.customerSnapshot as any)?.pageCount || 0), expiresAt: share.expiresAt, expiredPricing: share.generation.validUntil <= new Date(), viewer: { name: session.viewer.name } };
    }

    static async page(rawToken: string, request: any, pageNumber: number, thumbnail: boolean) {
        const { share, session } = await this.accepted(rawToken, request);
        const pageCount = Number((share.customerSnapshot as any)?.pageCount || 0);
        if (pageNumber < 1 || pageNumber > pageCount) throw new Error('Unavailable');
        const pages = assertPrivateSharePath(share.personalizedPagesPath, share.id);
        const imageDirectory = thumbnail ? path.join(path.dirname(pages), 'thumbnails') : pages;
        const file = assertPrivateSharePath(path.join(imageDirectory, `page-${pageNumber}.png`), share.id);
        const png = await fs.promises.readFile(file);
        const context = requestContext(request);
        await this.log(share, session.viewer.id, session.id, thumbnail ? 'THUMBNAIL_VIEW' : 'PAGE_VIEW', true, context, { pageNumber }, pageNumber);
        if (!thumbnail && !context.isScanner && !session.viewer.firstAccessedAt) {
            const changed = await (prisma as any).wholesaleCatalogViewer.updateMany({ where: { id: session.viewer.id, firstAccessedAt: null }, data: { firstAccessedAt: new Date(), lastAccessedAt: new Date() } });
            if (changed.count) {
                await (prisma as any).wholesaleCatalogShare.update({ where: { id: share.id }, data: { lastAccessedAt: new Date() } });
                await AuditService.log(share.accountId, null, AuditActions.WHOLESALE_SHARE_FIRST_ACCESSED, 'WHOLESALE_CATALOG_SHARE', share.id, { viewerId: session.viewer.id });
                if (!areViewerNotificationsMuted(share)) {
                    try { await (prisma as any).notification.create({ data: { accountId: share.accountId, title: 'Wholesale catalog opened', message: 'A protected customer catalog was opened for the first time.', type: 'SUCCESS', link: `/wholesale-catalog/${share.catalogId}` } }); } catch (error) { Logger.warn('[WholesaleViewer] First access notification failed', { shareId: share.id, error }); }
                    void this.emailCreator(share, `wholesale-viewer-first:${session.viewer.id}`, 'Wholesale catalog opened', `<p>${escapeHtml(session.viewer.name)} opened the first page of ${escapeHtml(share.catalog.publicTitle)}.</p>`);
                }
            }
        } else if (!thumbnail) await (prisma as any).wholesaleCatalogViewer.update({ where: { id: session.viewer.id }, data: { lastAccessedAt: new Date() } });
        const customer = share.customerSnapshot as any;
        return watermarkSvg(png, `${session.viewer.name} <${session.viewer.email}>`, customer.company, share.confidentialityTextSnapshot, thumbnail, share.generation.validUntil <= new Date());
    }

    static async logout(rawToken: string, request: any) {
        const share = await activeShare(rawToken);
        const session = await sessionFor(request, share);
        await (prisma as any).wholesaleCatalogViewerSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    }

    private static async accepted(rawToken: string, request: any) {
        const share = await activeShare(rawToken);
        const session = await sessionFor(request, share);
        if (!session.viewer?.confidentialityAcceptedAt || session.viewer.acceptedConfidentialityHash !== share.confidentialityHash) throw new Error('Unavailable');
        return { share, session };
    }

    static async emailCreator(share: any, sourceId: string, subject: string, html: string) {
        try {
            if (!share.createdBy?.email) return;
            const existing = await (prisma as any).emailLog.count({ where: { accountId: share.accountId, source: 'WHOLESALE_CATALOG_VIEWER', sourceId } });
            if (existing) return;
            const emailAccount = await getDefaultEmailAccount(share.accountId);
            if (!emailAccount) return;
            await new EmailService().sendEmail(share.accountId, emailAccount.id, share.createdBy.email, subject, html, undefined, { source: 'WHOLESALE_CATALOG_VIEWER', sourceId, category: 'TRANSACTIONAL' });
        } catch (error) { Logger.warn('[WholesaleViewer] Creator email failed', { shareId: share.id, sourceId, error }); }
    }

    private static log(share: any, viewerId: string | null, sessionId: string | null, eventType: string, success: boolean, context: any, metadata?: any, pageNumber?: number) {
        return (prisma as any).wholesaleCatalogAccessLog.create({ data: { accountId: share.accountId, shareId: share.id, viewerId, sessionId, eventType, success, ...context, deviceSummary: undefined, metadata, pageNumber } });
    }
}

function escapeHtml(value: unknown) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
