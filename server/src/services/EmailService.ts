/**
 * Email Service
 * 
 * Handles SMTP sending and IMAP receiving using the unified EmailAccount model.
 */

import { EmailAccount, Prisma } from '@prisma/client';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import { prisma } from '../utils/prisma';
import { EventBus, EVENTS } from './events';
import { Logger } from '../utils/logger';
import { decrypt } from '../utils/encryption';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getAttachmentUrl } from '../utils/attachmentUrl';
import { ensureEmailDocument, emailPlainText } from '../utils/emailContent';
import { classifySendFailure, EmailDeferredError, reserveEmailSend } from './emailSendLifecycle';

interface EmailSendOptions {
    source?: string;
    sourceId?: string;
    inReplyTo?: string;
    references?: string;
    category?: 'MARKETING' | 'TRANSACTIONAL';
    isInboxReply?: boolean;
    fromName?: string;
    fromEmail?: string;
    replyToEmail?: string;
    listId?: string;
    idempotencyKey?: string;
}

const attachmentsDir = path.join(__dirname, '../../uploads/attachments');
if (!fs.existsSync(attachmentsDir)) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
}

async function safeRelayJson(response: Response, endpoint: string): Promise<any> {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const bodySnippet = (await response.text()).slice(0, 200);
        Logger.warn('[EmailService] Relay returned non-JSON response', { status: response.status, contentType, bodySnippet, endpoint });
        throw new Error('Relay returned a non-JSON response');
    }

    return response.json();
}

export class EmailService {
    private static readonly RELAY_MAX_ATTACHMENTS = 10;
    private static readonly RELAY_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
    private static readonly DEFAULT_SENT_BODY_RETENTION_DAYS = 30;
    private static readonly DEFAULT_SENT_BODY_MAX_CHARS = 500_000;

    private getSentBodyRetentionDays() {
        const configured = Number.parseInt(process.env.EMAIL_LOG_BODY_RETENTION_DAYS || '', 10);
        return Number.isFinite(configured) && configured > 0
            ? configured
            : EmailService.DEFAULT_SENT_BODY_RETENTION_DAYS;
    }

    private getSentBodyMaxChars() {
        const configured = Number.parseInt(process.env.EMAIL_LOG_BODY_MAX_CHARS || '', 10);
        return Number.isFinite(configured) && configured > 0
            ? configured
            : EmailService.DEFAULT_SENT_BODY_MAX_CHARS;
    }

    private getSentBodyExpiresAt() {
        return new Date(Date.now() + this.getSentBodyRetentionDays() * 24 * 60 * 60 * 1000);
    }

    private buildStoredSentBodyPayload(html: string, options?: EmailSendOptions, canonicalHtml?: string, attachments?: any[]): Prisma.InputJsonValue {
        const maxChars = this.getSentBodyMaxChars();
        const truncated = html.length > maxChars;
        return {
            html: truncated ? html.slice(0, maxChars) : html,
            type: 'send_payload_v2',
            canonicalHtml: canonicalHtml || html,
            attachments: JSON.parse(JSON.stringify(attachments || [], (_key, value) =>
                value?.type === 'Buffer' && Array.isArray(value.data)
                    ? { storedBuffer: Buffer.from(value.data).toString('base64') } : value)),
            options: JSON.parse(JSON.stringify(options || {})),
            truncated,
            originalLength: html.length,
            storedAt: new Date().toISOString(),
            category: options?.category || 'MARKETING'
        };
    }

    static async cleanupExpiredStoredBodies(): Promise<{ cleared: number }> {
        const result = await prisma.emailLog.updateMany({
            where: {
                emailBodyExpiresAt: { lt: new Date() },
                status: { in: ['SUCCESS', 'RETRIED', 'BOUNCED', 'COMPLAINED'] }
            },
            data: {
                emailPayload: Prisma.DbNull,
                emailBodyExpiresAt: null
            }
        });

        Logger.info('[EmailService] Expired sent-body cleanup completed', { cleared: result.count });
        return { cleared: result.count };
    }

    private wait(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private getMarketingPressureCapConfig() {
        const maxPerWindow = Number.parseInt(process.env.MARKETING_PRESSURE_MAX_SENDS || '3', 10);
        const windowHours = Number.parseInt(process.env.MARKETING_PRESSURE_WINDOW_HOURS || '24', 10);
        return {
            maxPerWindow: Number.isFinite(maxPerWindow) && maxPerWindow > 0 ? maxPerWindow : 3,
            windowHours: Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24
        };
    }

    private async enforceMarketingPressureCap(accountId: string, to: string, source?: string): Promise<{ allowed: boolean; reason?: string }> {
        const sourceKey = String(source || '').toUpperCase();
        const isMarketingAutomationOrCampaign = sourceKey === 'AUTOMATION' || sourceKey === 'CAMPAIGN';
        if (!isMarketingAutomationOrCampaign) {
            return { allowed: true };
        }

        const { maxPerWindow, windowHours } = this.getMarketingPressureCapConfig();
        const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

        const sentInWindow = await prisma.emailLog.count({
            where: {
                accountId,
                to: { equals: to, mode: 'insensitive' },
                status: { in: ['SUCCESS', 'RETRIED'] },
                source: { in: ['AUTOMATION', 'CAMPAIGN'] },
                lastAttemptAt: { gte: windowStart }
            }
        });

        if (sentInWindow >= maxPerWindow) {
            return {
                allowed: false,
                reason: `Contact pressure cap reached (${sentInWindow}/${maxPerWindow} in ${windowHours}h)`
            };
        }

        return { allowed: true };
    }

    private buildApiBaseUrl() {
        return (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
    }

    private injectClickTracking(html: string, trackingId: string): string {
        const clickBase = `${this.buildApiBaseUrl()}/api/email/click/${trackingId}?url=`;
        return html.replace(/<a\b([^>]*?)href=("|')(https?:\/\/[^"']+)(\2)([^>]*)>/gi, (_match, preAttrs, quote, href, _quote2, postAttrs) => {
            // Preserve ESP/unsubscribe merge tags so downstream providers can expand them.
            // Tracking unresolved placeholders breaks one-click unsubscribe links.
            if (href.includes('{{') || href.includes('}}')) {
                return `<a${preAttrs}href=${quote}${href}${quote}${postAttrs}>`;
            }
            const trackedHref = `${clickBase}${encodeURIComponent(href)}`;
            return `<a${preAttrs}href=${quote}${trackedHref}${quote}${postAttrs}>`;
        });
    }

    private prepareStoredHtmlForResend(html: string): string {
        return html
            .replace(/<img\b[^>]*src=("|')[^"']*\/api\/email\/track\/[^"']+\.png[^"']*\1[^>]*>/gi, '')
            .replace(/href=("|')https?:\/\/[^"']*\/api\/email\/click\/[^"']+\?url=([^"']+)\1/gi, (_match, quote, encodedUrl) => {
                try {
                    return `href=${quote}${decodeURIComponent(encodedUrl)}${quote}`;
                } catch {
                    return _match;
                }
            });
    }

    private buildUnsubscribeHeaderUrl(trackingId: string): string {
        return `${this.buildApiBaseUrl()}/api/email/unsubscribe/${trackingId}`;
    }

    private buildPreferencesUrl(trackingId: string): string {
        // The unsubscribe GET route renders the preference centre; preferences GET is JSON.
        return this.buildUnsubscribeHeaderUrl(trackingId);
    }

    private buildListUnsubscribeUrl(trackingId: string, listId: string): string {
        return `${this.buildApiBaseUrl()}/api/email/unsubscribe-list/${trackingId}/${listId}`;
    }

    private shouldRejectUnauthorizedTls(): boolean {
        const allowInsecure = process.env.ALLOW_INSECURE_TLS === 'true';
        if (allowInsecure && process.env.NODE_ENV !== 'production') {
            return false;
        }
        return true;
    }

    // -------------------
    // Sending (SMTP)
    // -------------------

    /**
     * Create nodemailer transporter for SMTP sending.
     */
    async createTransporter(account: EmailAccount) {
        if (!account.smtpEnabled || !account.smtpHost || !account.smtpPort || !account.smtpPassword) {
            throw new Error('SMTP not configured for this account');
        }

        // Port 465 uses implicit TLS, port 587 uses STARTTLS
        const useImplicitTLS = account.smtpPort === 465;

        const decryptedPassword = decrypt(account.smtpPassword);

        return nodemailer.createTransport({
            host: account.smtpHost,
            port: account.smtpPort,
            secure: useImplicitTLS,
            requireTLS: !useImplicitTLS && account.smtpSecure,
            auth: {
                user: account.smtpUsername || account.email,
                pass: decryptedPassword,
            },
            tls: {
                rejectUnauthorized: this.shouldRejectUnauthorizedTls(),
                servername: account.smtpHost
            },
            // Timeout configuration to prevent infinite hangs
            connectionTimeout: 10000,  // 10 seconds to establish connection
            greetingTimeout: 10000,    // 10 seconds for greeting
            socketTimeout: 30000       // 30 seconds for socket operations
        });
    }

    /**
     * Send email via SMTP or HTTP relay.
     * 
     * Prioritizes HTTP relay if configured (for SMTP-blocked environments),
     * uses direct SMTP otherwise. Ambiguous relay failures never fall back.
     */
    async sendEmail(
        accountId: string, emailAccountId: string, to: string, subject: string,
        html: string, attachments?: any[], options?: EmailSendOptions
    ) {
        return this.sendEmailAttempt(accountId, emailAccountId, to, subject, html, attachments, options);
    }

    private async sendEmailAttempt(
        accountId: string,
        emailAccountId: string,
        to: string,
        subject: string,
        html: string,
        attachments?: any[],
        options?: EmailSendOptions,
        retryLogId?: string
    ) {
        const existing = !retryLogId && options?.idempotencyKey
            ? await prisma.emailLog.findUnique({ where: { accountId_idempotencyKey: { accountId, idempotencyKey: options.idempotencyKey } } })
            : null;
        if (existing && existing.status !== 'QUEUED') {
            if (['SUCCESS', 'RETRIED', 'BOUNCED', 'COMPLAINED'].includes(existing.status)) {
                return { messageId: existing.messageId || undefined, deduplicated: true };
            }
            if (existing.status === 'SKIPPED') return { skipped: true, reason: existing.errorMessage || 'previously_skipped' };
            throw new Error(`Email already attempted (${existing.status}); use the email log retry action if available`);
        }
        // Queued sends retain the original content even if a campaign is edited later.
        if (existing) {
            const stored = existing.emailPayload as any;
            html = stored.canonicalHtml;
            attachments = this.restoreAttachments(stored.attachments);
            options = stored.options;
            subject = existing.subject;
            emailAccountId = existing.emailAccountId;
            to = existing.to;
        }
        const writeSkipped = (data: any) => retryLogId || existing
            ? prisma.emailLog.updateMany({ where: { id: retryLogId || existing!.id, status: { in: ['QUEUED', 'PENDING_RETRY'] } }, data })
            : prisma.emailLog.create({ data: { ...data, idempotencyKey: options?.idempotencyKey } });
        const emailAccount = await prisma.emailAccount.findFirst({
            where: { id: emailAccountId, accountId }
        });

        if (!emailAccount) {
            throw new Error("Email account not found");
        }

        const emailCategory = options?.category || 'MARKETING';

        if (emailCategory === 'MARKETING') {
            const pressureCheck = await this.enforceMarketingPressureCap(accountId, to, options?.source);
            if (!pressureCheck.allowed) {
                await writeSkipped({
                        accountId,
                        emailAccountId,
                        to,
                        subject,
                        status: 'SKIPPED',
                        errorMessage: pressureCheck.reason || 'Marketing pressure cap reached',
                        source: options?.source,
                        sourceId: options?.sourceId,
                        canRetry: false
                });
                return { skipped: true, reason: 'contact_pressure_cap_reached' };
            }
        }

        // Explicit editor previews are operator-requested tests, not audience sends.
        // Keep their category for rendering, but do not require a subscription.
        const unsubscribe = emailCategory === 'MARKETING' && options?.source !== 'TEST'
            ? await prisma.emailUnsubscribe.findFirst({
                where: {
                    accountId,
                    email: { equals: to, mode: 'insensitive' },
                    scope: { in: ['MARKETING', 'ALL'] }
                },
                select: { id: true, scope: true }
            })
            : null;
        if (unsubscribe) {
            await writeSkipped({
                    accountId,
                    emailAccountId,
                    to,
                    subject,
                    status: 'SKIPPED',
                    errorMessage: `Recipient is unsubscribed (${unsubscribe.scope.toLowerCase()})`,
                    source: options?.source,
                    sourceId: options?.sourceId,
                    canRetry: false
            });
            Logger.info('Skipping email to unsubscribed recipient', {
                accountId,
                to,
                source: options?.source,
                category: emailCategory,
                unsubscribeScope: unsubscribe.scope
            });
            return { skipped: true, reason: `unsubscribed_${unsubscribe.scope.toLowerCase()}` };
        }

        // Generate tracking ID for read receipts
        const trackingId = crypto.randomUUID();
        const trackingPixelUrl = `${this.buildApiBaseUrl()}/api/email/track/${trackingId}.png`;
        // Editors may URL-encode braces or prepend a protocol to link placeholders.
        // Canonicalize before click tracking so these links remain untracked.
        const normalizedHtml = ensureEmailDocument(html).replace(
            /(?:https?:\/\/)?(?:\{\{|%7B%7B)\s*(unsubscribe_url|unsubscribe_list_url|preferences_url)\s*(?:\}\}|%7D%7D)\/?/gi,
            (_match, tag) => `{{${tag.toLowerCase()}}}`
        );
        const htmlWithClickTracking = this.injectClickTracking(normalizedHtml, trackingId);

        // Inject tracking pixel
        const htmlWithTracking = htmlWithClickTracking.includes('</body>')
            ? htmlWithClickTracking.replace('</body>', `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" /></body>`)
            : `${htmlWithClickTracking}<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />`;

        // Shared footers also appear in transactional mail. Resolve their links,
        // while reserving automatic one-click unsubscribe headers for marketing.
        const unsubscribeUrl = this.buildUnsubscribeHeaderUrl(trackingId);
        const preferencesUrl = this.buildPreferencesUrl(trackingId);
        const listUnsubscribeUrl = options?.listId
            ? this.buildListUnsubscribeUrl(trackingId, options.listId)
            : null;

        let htmlWithMergeTagUrls = htmlWithTracking;
        if (unsubscribeUrl) {
            htmlWithMergeTagUrls = htmlWithMergeTagUrls.replace(/https?:\/\/\{\{unsubscribe_url\}\}\/?/gi, unsubscribeUrl);
            htmlWithMergeTagUrls = htmlWithMergeTagUrls.replace(/\{\{unsubscribe_url\}\}/g, unsubscribeUrl);
        }
        if (preferencesUrl) {
            htmlWithMergeTagUrls = htmlWithMergeTagUrls.replace(/\{\{preferences_url\}\}/g, preferencesUrl);
        }
        if (listUnsubscribeUrl) {
            htmlWithMergeTagUrls = htmlWithMergeTagUrls.replace(/https?:\/\/\{\{unsubscribe_list_url\}\}\/?/gi, listUnsubscribeUrl);
            htmlWithMergeTagUrls = htmlWithMergeTagUrls.replace(/\{\{unsubscribe_list_url\}\}/g, listUnsubscribeUrl);
        } else if (preferencesUrl) {
            htmlWithMergeTagUrls = htmlWithMergeTagUrls.replace(/https?:\/\/\{\{unsubscribe_list_url\}\}\/?/gi, preferencesUrl);
            htmlWithMergeTagUrls = htmlWithMergeTagUrls.replace(/\{\{unsubscribe_list_url\}\}/g, preferencesUrl);
        }

        const overrideFromEmail = options?.fromEmail?.trim();
        const overrideFromName = options?.fromName?.trim();
        const replyToEmail = options?.replyToEmail?.trim();
        const emailLike = /^\S+@\S+\.\S+$/;
        if (overrideFromEmail && !emailLike.test(overrideFromEmail)) {
            throw new Error('Override From Email is invalid');
        }
        if (replyToEmail && !emailLike.test(replyToEmail)) {
            throw new Error('Reply To Email is invalid');
        }
        const senderEmail = overrideFromEmail || emailAccount.email;
        const senderName = overrideFromName || emailAccount.name;

        const useRelay = Boolean(emailAccount.relayEndpoint && emailAccount.relayApiKey);
        if (!useRelay && !emailAccount.smtpEnabled) {
            throw new Error("Neither HTTP relay nor SMTP is configured for this account");
        }

        const payload = this.buildStoredSentBodyPayload(htmlWithMergeTagUrls, options, html, attachments);
        // Persist before any transport side effect. A stale SENDING row is intentionally
        // not automatically retried: delivery may have happened before the worker died.
        const log = retryLogId
            ? await prisma.emailLog.findFirstOrThrow({ where: { id: retryLogId, accountId } })
            : existing ||
            await prisma.emailLog.create({ data: {
                accountId, emailAccountId, to, subject, trackingId,
                status: 'QUEUED', canRetry: false,
                source: options?.source, sourceId: options?.sourceId,
                idempotencyKey: options?.idempotencyKey,
                emailPayload: payload, emailBodyExpiresAt: this.getSentBodyExpiresAt()
            } });
        let retryAt: Date | null = null;
        for (let cycle = 0; cycle < 20; cycle++) {
            retryAt = await reserveEmailSend(accountId, log.id, emailCategory === 'MARKETING');
            if (!retryAt) break;
            if (retryAt.getTime() - Date.now() > 2000) break;
            await this.wait(100);
        }
        if (retryAt) {
            // Campaign jobs resume keyed QUEUED rows. Unkeyed callers have no
            // resumable job, so expose their unsent message through manual retry.
            if (!options?.idempotencyKey && !retryLogId) {
                await prisma.emailLog.update({ where: { id: log.id }, data: {
                    status: 'FAILED', canRetry: true,
                    errorMessage: `Sending limit reached; retry after ${retryAt.toISOString()}`
                } });
            }
            throw new EmailDeferredError(retryAt);
        }
        await prisma.emailLog.update({ where: { id: log.id }, data: {
            trackingId, emailPayload: payload, emailBodyExpiresAt: this.getSentBodyExpiresAt()
        } });

        let transporter: Awaited<ReturnType<typeof this.createTransporter>> | null = null;
        let info: any;
        try {
            if (useRelay) {
                const result = await this.sendViaHttpRelay(emailAccount, accountId, to, subject, htmlWithMergeTagUrls, attachments, {
                    ...options, unsubscribeUrl: emailCategory === 'MARKETING' ? unsubscribeUrl : undefined,
                    idempotencyKey: log.id
                });
                info = { messageId: result.message_id };
            } else {
                transporter = await this.createTransporter(emailAccount);
                info = await transporter.sendMail({
                    from: { name: senderName, address: senderEmail },
                    to, subject, html: htmlWithMergeTagUrls, text: emailPlainText(htmlWithMergeTagUrls), attachments,
                    inReplyTo: options?.inReplyTo,
                    references: options?.references,
                    replyTo: replyToEmail,
                    headers: emailCategory === 'MARKETING'
                        ? {
                            'List-Unsubscribe': `<${unsubscribeUrl}>`,
                            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
                        }
                        : undefined
                });
            }
        } catch (error: any) {
            const failure = classifySendFailure(error);
            await prisma.emailLog.update({
                where: { id: log.id },
                data: {
                    ...failure,
                    canRetry: failure.canRetry && log.retryCount < log.maxRetries,
                    errorMessage: error.message,
                    errorCode: String(error.code || error.responseCode || '')
                }
            });
            Logger.error(`Failed to send email`, { to, error: error.message });
            throw error;
        } finally {
            try { transporter?.close(); } catch { /* delivery outcome is independent of cleanup */ }
        }
        // A persistence failure after acceptance must never trigger another transport.
        try {
            await prisma.emailLog.update({ where: { id: log.id }, data: {
                status: 'SUCCESS', messageId: info.messageId, canRetry: false,
                errorMessage: null, errorCode: null
            } });
        } catch (error) {
            Logger.error('Email accepted but success log could not be saved; do not automatically retry', { emailLogId: log.id, messageId: info.messageId, error });
        }
        return info;
    }

    private restoreAttachments(attachments: any[] = []): any[] {
        return JSON.parse(JSON.stringify(attachments), (_key, value) =>
            value?.storedBuffer ? Buffer.from(value.storedBuffer, 'base64') : value);
    }

    /**
     * Retry a failed email from the log.
     * 
     * Retrieves the stored payload and attempts to resend.
     */
    async retryFailedEmail(emailLogId: string, accountId: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
        const emailLog = await prisma.emailLog.findFirst({
            where: {
                id: emailLogId,
                accountId,
                status: 'FAILED',
                canRetry: true
            },
            include: {
                emailAccount: true
            }
        });

        if (!emailLog) {
            return { success: false, error: 'Email log not found or cannot be retried' };
        }

        if (emailLog.retryCount >= emailLog.maxRetries) {
            await prisma.emailLog.update({
                where: { id: emailLogId },
                data: { canRetry: false }
            });
            return { success: false, error: 'Maximum retry attempts reached' };
        }

        const payload = emailLog.emailPayload as { html?: string; canonicalHtml?: string; attachments?: any[]; options?: any } | null;
        if (!payload || !payload.html) {
            return { success: false, error: 'No stored payload for retry' };
        }

        // Update retry attempt tracking
        const claim = await prisma.emailLog.updateMany({
            where: { id: emailLogId, accountId, status: 'FAILED', canRetry: true, retryCount: emailLog.retryCount },
            data: {
                retryCount: { increment: 1 },
                lastRetryAt: new Date(),
                status: 'PENDING_RETRY'
            }
        });
        if (claim.count !== 1) return { success: false, error: 'Email retry already claimed' };

        try {
            const result = await this.sendEmailAttempt(
                accountId,
                emailLog.emailAccountId,
                emailLog.to,
                emailLog.subject,
                payload.canonicalHtml || this.prepareStoredHtmlForResend(payload.html),
                this.restoreAttachments(payload.attachments),
                {
                    source: emailLog.source || undefined,
                    sourceId: emailLog.sourceId || undefined,
                    ...payload.options
                },
                emailLogId
            );

            if (result && typeof result === 'object' && 'skipped' in result && result.skipped) {
                const reason = 'reason' in result ? result.reason : 'email skipped';
                await prisma.emailLog.update({
                    where: { id: emailLogId },
                    data: {
                        canRetry: false,
                        status: 'FAILED',
                        errorMessage: `Retry blocked: ${reason}`
                    }
                });
                return { success: false, error: reason };
            }

            return { success: true, messageId: result.messageId };
        } catch (error: any) {
            // Only release pre-transport claims. Never turn SENDING/UNKNOWN back
            // into retryable after a transport or persistence failure.
            await prisma.emailLog.updateMany({
                where: { id: emailLogId, accountId, status: 'PENDING_RETRY' },
                data: {
                    status: 'FAILED',
                    canRetry: error instanceof EmailDeferredError || emailLog.retryCount + 1 < emailLog.maxRetries,
                    ...(error instanceof EmailDeferredError ? { retryCount: { decrement: 1 } } : {}),
                    errorMessage: `Retry ${emailLog.retryCount + 1} failed: ${error.message}`
                }
            });

            return { success: false, error: error.message };
        }
    }

    /**
     * Resend using the canonical payload, with preview fallback for legacy logs.
     *
     * Creates a new EmailLog entry for the resend; the original log is left intact.
     */
    async resendEmail(emailLogId: string, accountId: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
        const emailLog = await prisma.emailLog.findFirst({
            where: { id: emailLogId, accountId },
            include: { emailAccount: true }
        });

        if (!emailLog) {
            return { success: false, error: 'Email log not found' };
        }
        if (['QUEUED', 'SENDING', 'PENDING_RETRY'].includes(emailLog.status)) {
            return { success: false, error: 'Email is still queued or in progress' };
        }

        const payload = emailLog.emailPayload as { html?: string; canonicalHtml?: string; attachments?: any[]; options?: any; category?: 'MARKETING' | 'TRANSACTIONAL'; truncated?: boolean } | null;
        if (!payload || typeof payload.html !== 'string') {
            return { success: false, error: 'Stored email body is not available for resend' };
        }

        if (payload.truncated === true && !payload.canonicalHtml) {
            return { success: false, error: 'Stored email body is truncated and cannot be resent safely' };
        }

        try {
            const result = await this.sendEmail(
                accountId,
                emailLog.emailAccountId,
                emailLog.to,
                emailLog.subject,
                payload.canonicalHtml || this.prepareStoredHtmlForResend(payload.html),
                this.restoreAttachments(payload.attachments),
                {
                    ...payload.options,
                    idempotencyKey: undefined,
                    source: emailLog.source || undefined,
                    sourceId: emailLog.sourceId || undefined,
                    category: payload.category || payload.options?.category || 'MARKETING'
                }
            );

            if (result && typeof result === 'object' && 'skipped' in result && result.skipped) {
                const reason = 'reason' in result ? result.reason : 'email skipped';
                return { success: false, error: String(reason) };
            }

            return { success: true, messageId: result.messageId };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Send email via HTTP relay endpoint.
     * 
     * Used when SMTP ports are blocked (e.g., DigitalOcean) and email 
     * must be routed through an external relay (e.g., WooCommerce plugin).
     */
    private async sendViaHttpRelay(
        emailAccount: EmailAccount,
        accountId: string,
        to: string,
        subject: string,
        html: string,
        attachments?: any[],
        options?: {
            inReplyTo?: string;
            references?: string;
            category?: 'MARKETING' | 'TRANSACTIONAL';
            unsubscribeUrl?: string;
            fromName?: string;
            fromEmail?: string;
            replyToEmail?: string;
            idempotencyKey?: string;
        }
    ): Promise<{ success: boolean; message_id: string }> {
        if (!emailAccount.relayEndpoint || !emailAccount.relayApiKey) {
            throw new Error('HTTP relay not configured');
        }

        const decryptedApiKey = decrypt(emailAccount.relayApiKey);

        // Convert attachments to base64 for JSON transport
        const base64Attachments: Array<{ filename: string; content: string; contentType: string }> = [];
        const attachmentErrors: string[] = [];
        if (attachments && attachments.length > 0) {
            if (attachments.length > EmailService.RELAY_MAX_ATTACHMENTS) {
                throw new Error(`Relay supports up to ${EmailService.RELAY_MAX_ATTACHMENTS} attachments per email`);
            }

            for (const att of attachments) {
                try {
                    if (!att?.path || typeof att.path !== 'string') {
                        throw new Error('Attachment path missing');
                    }

                    const stats = fs.statSync(att.path);
                    if (stats.size > EmailService.RELAY_MAX_ATTACHMENT_BYTES) {
                        throw new Error(`Attachment exceeds ${Math.round(EmailService.RELAY_MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB limit`);
                    }

                    const fileBuffer = fs.readFileSync(att.path);
                    base64Attachments.push({
                        filename: att.filename || 'attachment',
                        content: fileBuffer.toString('base64'),
                        contentType: att.contentType || 'application/octet-stream'
                    });
                } catch (err: any) {
                    const filename = att?.filename || att?.path || 'attachment';
                    const reason = err?.message || 'Failed to process attachment';
                    attachmentErrors.push(`${filename}: ${reason}`);
                    Logger.warn('Failed to read attachment for relay', {
                        path: att?.path,
                        filename: att?.filename,
                        error: reason
                    });
                }
            }

            if (base64Attachments.length !== attachments.length) {
                throw new Error(`Relay attachment validation failed. ${attachmentErrors.join('; ')}`);
            }
        }

        const payload = {
            account_id: accountId,
            to,
            subject,
            html,
            text: emailPlainText(html),
            from_name: options?.fromName?.trim() || emailAccount.name,
            from_email: options?.fromEmail?.trim() || emailAccount.email,
            reply_to: options?.replyToEmail?.trim() || undefined,
            relay_profile_id: emailAccount.relayProfileId || undefined,
            in_reply_to: options?.inReplyTo,
            references: options?.references,
            list_unsubscribe: options?.unsubscribeUrl,
            list_unsubscribe_post: options?.unsubscribeUrl ? 'List-Unsubscribe=One-Click' : undefined,
            attachments: base64Attachments.length > 0 ? base64Attachments : undefined
        };

        try {
            const response = await fetch(emailAccount.relayEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Relay-Key': decryptedApiKey,
                    'Idempotency-Key': options?.idempotencyKey || crypto.randomUUID()
                },
                signal: AbortSignal.timeout(30_000),
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Relay request failed: ${response.status}`);
            }

            const result = await safeRelayJson(response, emailAccount.relayEndpoint);

            if (!result.success) {
                throw new Error(result.error || 'Relay returned unsuccessful response');
            }

            return result;
        } catch (error: any) {
            // The relay may have delivered before its response was lost, malformed,
            // or replaced by a proxy error. Never fall back or blindly retry.
            error.deliveryUnknown = true;
            throw error;
        }
    }

    /**
     * Verify SMTP or IMAP connection.
     */
    async verifyConnection(account: { host: string; port: number; username: string; password: string; type: string; isSecure: boolean }): Promise<boolean> {
        if (account.type === 'SMTP') {
            try {
                const useImplicitTLS = account.port === 465;
                const transporter = nodemailer.createTransport({
                    host: account.host,
                    port: account.port,
                    secure: useImplicitTLS,
                    requireTLS: !useImplicitTLS && account.isSecure,
                    auth: {
                        user: account.username,
                        pass: account.password,
                    },
                    tls: {
                        rejectUnauthorized: this.shouldRejectUnauthorizedTls(),
                        servername: account.host
                    }
                });
                await transporter.verify();
                transporter.close();
                return true;
            } catch (error) {
                Logger.error('SMTP Verify Error', { error });
                throw error;
            }
        } else if (account.type === 'IMAP') {
            try {
                const useImplicitTLS = account.port === 993;
                const client = new ImapFlow({
                    host: account.host,
                    port: account.port,
                    secure: useImplicitTLS,
                    auth: {
                        user: account.username,
                        pass: account.password
                    },
                    logger: false,
                    tls: {
                        rejectUnauthorized: this.shouldRejectUnauthorizedTls(),
                    } as any
                });

                await client.connect();
                await client.logout();
                return true;
            } catch (error) {
                Logger.error('IMAP Verify Error', { error });
                throw error;
            }
        }
        return false;
    }

    // -------------------
    // Receiving (IMAP)
    // -------------------

    /**
     * Check for new emails via IMAP.
     */
    async checkEmails(emailAccountId: string) {
        const account = await prisma.emailAccount.findUnique({ where: { id: emailAccountId } });
        if (!account) {
            Logger.warn('[checkEmails] Email account not found', { emailAccountId });
            return;
        }
        if (!account.imapEnabled) {
            Logger.warn('[checkEmails] IMAP not enabled, skipping', { emailAccountId });
            return;
        }
        if (!account.imapHost || !account.imapPort || !account.imapPassword) {
            Logger.warn('[checkEmails] IMAP not fully configured', { emailAccountId });
            return;
        }

        // Debug log to verify what settings we're using
        Logger.info('[checkEmails] IMAP config', {
            email: account.email,
            imapHost: account.imapHost,
            imapPort: account.imapPort,
            imapUsername: account.imapUsername || account.email,
            hasPassword: !!account.imapPassword,
            passwordLength: account.imapPassword?.length
        });

        // Port 993 uses implicit TLS, port 143 uses STARTTLS
        const useImplicitTLS = account.imapPort === 993;

        let decryptedPassword: string;
        try {
            decryptedPassword = decrypt(account.imapPassword);
        } catch (e: any) {
            Logger.error('[checkEmails] Failed to decrypt IMAP password', {
                emailAccountId,
                error: e?.message || String(e)
            });
            return;
        }

        const MAX_MESSAGES_PER_POLL = 10; // Limit to prevent long-running connections

        const client = new ImapFlow({
            host: account.imapHost,
            port: account.imapPort,
            secure: useImplicitTLS,
            auth: {
                user: account.imapUsername || account.email,
                pass: decryptedPassword
            },
            logger: false,
            emitLogs: false,
            connectionTimeout: 15000, // 15 second connection timeout (reduced)
            greetingTimeout: 10000,   // 10 second greeting timeout (reduced)
            socketTimeout: 30000,     // 30 second socket timeout (reduced from 60s)
            tls: {
                rejectUnauthorized: this.shouldRejectUnauthorizedTls(),
            } as any
        });

        // Handle connection errors
        client.on('error', (err: Error) => {
            Logger.error('[checkEmails] IMAP client error event', { email: account.email, error: err.message });
        });

        // Retry logic for connection with exponential backoff
        const MAX_RETRIES = 2;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
                    Logger.info(`[checkEmails] Retry attempt ${attempt}/${MAX_RETRIES} after ${delay}ms`, { email: account.email });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                Logger.info('[checkEmails] Connecting to IMAP server', {
                    host: account.imapHost,
                    port: account.imapPort,
                    email: account.email,
                    secure: useImplicitTLS,
                    attempt: attempt + 1
                });
                await client.connect();

                // Verify connection is actually open
                if (!client.usable) {
                    throw new Error('IMAP connection not usable after connect');
                }
                Logger.info('[checkEmails] Connection established successfully');
                lastError = null;
                break; // Success, exit retry loop
            } catch (connectError: any) {
                lastError = connectError;
                Logger.warn(`[checkEmails] Connection attempt ${attempt + 1} failed`, {
                    email: account.email,
                    error: connectError?.message || String(connectError)
                });

                // Clean up failed connection before retry
                try { await client.logout(); } catch { /* ignore */ }
            }
        }

        if (lastError) {
            Logger.error('[checkEmails] All connection attempts failed', {
                email: account.email,
                error: lastError.message,
                attempts: MAX_RETRIES + 1
            });
            return;
        }

        try {
            const lock = await client.getMailboxLock('INBOX');
            Logger.info('[checkEmails] Connected and locked INBOX');

            let messageCount = 0;
            const processedUids: number[] = []; // Collect UIDs to mark as seen AFTER loop

            try {
                for await (const message of client.fetch({ seen: false }, {
                    envelope: true,
                    bodyStructure: true,
                    source: true
                })) {
                    // Limit messages per poll to avoid long-running connections
                    if (messageCount >= MAX_MESSAGES_PER_POLL) {
                        Logger.info(`[checkEmails] Reached batch limit of ${MAX_MESSAGES_PER_POLL}, will continue in next poll`);
                        break;
                    }

                    messageCount++;
                    try {
                        const source = message.source;
                        if (!source) {
                            Logger.warn('[checkEmails] Message has no source', { uid: message.uid });
                            continue;
                        }

                        // Store UID for marking as seen AFTER the loop
                        // NOTE: imapflow docs warn that calling messageFlagsAdd inside fetch loop causes DEADLOCK
                        processedUids.push(message.uid);

                        const parsed: ParsedMail = await simpleParser(source, { skipImageLinks: true });

                        const subject = parsed.subject || '(No Subject)';
                        const fromAddress = parsed.from?.value[0];
                        const fromEmail = fromAddress?.address || '';
                        const fromName = fromAddress?.name || '';
                        const messageId = parsed.messageId || message.envelope.messageId || `local-${Date.now()}`;
                        const inReplyTo = parsed.inReplyTo || message.envelope.inReplyTo || undefined;

                        let references: string | undefined;
                        if (typeof parsed.references === 'string') {
                            references = parsed.references;
                        } else if (Array.isArray(parsed.references)) {
                            references = parsed.references.join(' ');
                        }

                        let html = parsed.html || false;
                        const text = parsed.text || '';
                        const processedAttachments: Array<{ filename: string; url: string; type: string }> = [];

                        // Process attachments
                        if (parsed.attachments && parsed.attachments.length > 0) {
                            for (const attachment of parsed.attachments) {
                                let isInline = false;
                                let isSignatureImage = false;

                                // Handle inline images
                                if (html && attachment.contentId && attachment.content && attachment.contentType) {
                                    const cid = attachment.contentId.replace(/^<|>$/g, '');
                                    // Only treat as inline if it's actually referenced in the HTML
                                    if (html.includes(`cid:${cid}`)) {
                                        const extensionFromName = attachment.filename?.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
                                        const extensionFromType = attachment.contentType.split('/')[1]?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
                                        const extension = extensionFromName || extensionFromType;
                                        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                                        const filename = `${uniqueSuffix}-inline-${cid.replace(/[^a-zA-Z0-9_-]/g, '') || 'image'}.${extension}`;
                                        const filePath = path.join(attachmentsDir, filename);
                                        fs.writeFileSync(filePath, attachment.content);
                                        const inlineUrl = getAttachmentUrl(filename);
                                        html = html.split(`cid:${cid}`).join(inlineUrl);
                                        isInline = true;
                                    }
                                }

                                // Detect signature images that shouldn't appear as attachments:
                                // - marked as "related" by mailparser (embedded in HTML context)
                                // - inline disposition + small size (logos, social icons)
                                // - inline disposition + generic name (image001.png, etc.)
                                // - signature-like orphaned CID: has a content-id but is NOT referenced in the HTML
                                // - tiny images < 1.5 KB (tracking pixels, 1x1 spacers)
                                // - known signature/logo filename patterns
                                if (!isInline && attachment.contentType?.startsWith('image/')) {
                                    const isRelated = (attachment as any).related === true;
                                    const isInlineDisposition = (attachment as any).contentDisposition === 'inline';
                                    const attachSize = attachment.size ?? attachment.content?.length ?? 0;
                                    const isSmall = attachSize > 0 && attachSize < 30000;
                                    const isTinyPixel = attachSize > 0 && attachSize < 1500;
                                    const hasGenericName = !attachment.filename ||
                                        /^image\d{0,3}\.\w+$/i.test(attachment.filename);

                                    // Orphaned CID: content-id exists but is not referenced anywhere in HTML.
                                    // Some clients add CIDs to real image attachments, so only treat this
                                    // as a signature signal when the part is related/inline.
                                    const rawCid = attachment.contentId?.replace(/^<|>$/g, '') ?? '';
                                    const hasOrphanedCid = !!(
                                        rawCid &&
                                        html &&
                                        !html.includes(`cid:${rawCid}`) &&
                                        (isRelated || isInlineDisposition)
                                    );

                                    // Common signature / branding filenames
                                    const hasSignatureFilename = !!attachment.filename &&
                                        /^(logo|signature|sig|banner|brand|header|footer|icon|avatar|divider|spacer|separator|bullet|pixel|tracker|tracking|beacon|dot|arrow)\d*[-_]?\w*\.(png|jpe?g|gif|webp|bmp)$/i.test(attachment.filename);

                                    const isOrphanedSignatureImage = hasOrphanedCid && (isRelated || isSmall || hasGenericName || hasSignatureFilename);

                                    const reason =
                                        isRelated ? 'related' :
                                        isTinyPixel ? 'tinyPixel' :
                                        isOrphanedSignatureImage ? 'orphanedCid' :
                                        hasSignatureFilename ? 'signatureFilename' :
                                        'inlineSmall';

                                    if (
                                        isRelated ||
                                        isTinyPixel ||
                                        isOrphanedSignatureImage ||
                                        hasSignatureFilename ||
                                        (isInlineDisposition && (isSmall || hasGenericName))
                                    ) {
                                        isSignatureImage = true;
                                        Logger.info('[checkEmails] Skipping signature image', {
                                            filename: attachment.filename,
                                            disposition: (attachment as any).contentDisposition,
                                            related: (attachment as any).related,
                                            size: attachSize,
                                            reason
                                        });
                                    }
                                }

                                // Handle regular attachments (or unreferenced inline ones)
                                if (!isInline && !isSignatureImage && attachment.filename && attachment.content) {
                                    try {
                                        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                                        const filename = uniqueSuffix + '-' + attachment.filename;
                                        const filePath = path.join(attachmentsDir, filename);

                                        fs.writeFileSync(filePath, attachment.content);

                                        processedAttachments.push({
                                            filename: attachment.filename,
                                            url: getAttachmentUrl(filename),
                                            type: attachment.contentType || 'application/octet-stream'
                                        });
                                    } catch (err) {
                                        Logger.error('[checkEmails] Failed to save attachment', { filename: attachment.filename, error: err });
                                    }
                                }
                            }
                        }

                        Logger.info(`[checkEmails] Processing email`, { fromEmail, subject, hasHtml: !!html, attachments: processedAttachments.length });

                        EventBus.emit(EVENTS.EMAIL.RECEIVED, {
                            emailAccountId,
                            fromEmail,
                            fromName,
                            subject,
                            body: text,
                            html: html || undefined,
                            messageId,
                            inReplyTo,
                            references,
                            attachments: processedAttachments
                        });

                        Logger.info(`[checkEmails] Emitted EMAIL.RECEIVED event`, { fromEmail, subject });
                    } catch (msgError: any) {
                        Logger.error('[checkEmails] Error processing individual message', {
                            messageUid: message.uid,
                            error: msgError?.message || String(msgError)
                        });
                    }
                }

                Logger.info(`[checkEmails] Found ${messageCount} unseen email(s)`, { email: account.email });

                // Mark all processed messages as seen AFTER the fetch loop completes
                // This avoids the deadlock issue documented in imapflow
                if (processedUids.length > 0) {
                    try {
                        // Use UID range for efficiency (e.g., "1,2,5,10" or "1:10")
                        const uidRange = processedUids.join(',');
                        await client.messageFlagsAdd(uidRange, ['\\Seen'], { uid: true });
                        Logger.info('[checkEmails] Successfully marked all messages as seen', {
                            count: processedUids.length,
                            uids: processedUids
                        });
                    } catch (flagError: any) {
                        Logger.error('[checkEmails] Failed to mark messages as seen', {
                            uids: processedUids,
                            error: flagError?.message || String(flagError),
                            stack: flagError?.stack
                        });
                    }
                }
            } finally {
                lock.release();
            }

            await client.logout();
            Logger.info('[checkEmails] Disconnected from IMAP server');
        } catch (error: any) {
            Logger.error(`[checkEmails] Error checking emails`, {
                email: account.email,
                error: error?.message || String(error),
                stack: error?.stack
            });
            try {
                await client.logout();
            } catch { /* ignore */ }
        }
    }
}
