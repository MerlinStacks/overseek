/**
 * Email Route - Fastify Plugin
 * 
 * Handles CRUD for unified email accounts with separate SMTP/IMAP configurations.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { EmailService } from '../services/EmailService';
import { requireAuthFastify } from '../middleware/auth';
import { encrypt, decrypt } from '../utils/encryption';

const emailService = new EmailService();

/** Request body for email account create/update */
interface EmailAccountBody {
    name?: string;
    email?: string;
    // SMTP
    smtpEnabled?: boolean;
    smtpHost?: string;
    smtpPort?: number | string;
    smtpUsername?: string;
    smtpPassword?: string;
    smtpSecure?: boolean;
    // IMAP
    imapEnabled?: boolean;
    imapHost?: string;
    imapPort?: number | string;
    imapUsername?: string;
    imapPassword?: string;
    imapSecure?: boolean;
    // HTTP Relay
    relayEndpoint?: string;
    relayApiKey?: string;
}

/** Test connection request */
interface TestConnectionBody {
    id?: string;
    protocol: 'SMTP' | 'IMAP';
    host: string;
    port: number | string;
    username: string;
    password: string;
    isSecure?: boolean;
}

interface SuppressionBody {
    email?: string;
    scope?: 'MARKETING' | 'ALL';
    reason?: string;
}

interface DeliveryEventBody {
    eventType?: 'BOUNCE' | 'COMPLAINT';
    reason?: string;
}

interface NormalizedDeliveryWebhookEntry {
    emailAccountId?: string;
    eventType: 'BOUNCE' | 'COMPLAINT';
    reason?: string;
    messageId?: string;
    trackingId?: string;
    recipientEmail?: string;
}

function getNestedString(source: unknown, paths: string[][]): string | undefined {
    for (const path of paths) {
        let current: unknown = source;

        for (const segment of path) {
            if (!current || typeof current !== 'object' || !(segment in (current as Record<string, unknown>))) {
                current = undefined;
                break;
            }
            current = (current as Record<string, unknown>)[segment];
        }

        if (typeof current === 'string' && current.trim()) {
            return current.trim();
        }
    }

    return undefined;
}

function mapRawDeliveryEventType(rawType: string | undefined): 'BOUNCE' | 'COMPLAINT' | null {
    if (!rawType) return null;

    const normalized = rawType.trim().toLowerCase();
    if ([
        'bounce',
        'bounced',
        'failed',
        'dropped',
        'reject',
        'rejected',
        'hard_bounce',
        'soft_bounce'
    ].includes(normalized)) {
        return 'BOUNCE';
    }

    if ([
        'complaint',
        'complained',
        'spam_complaint',
        'spam complaint',
        'spamreport',
        'spam_report'
    ].includes(normalized)) {
        return 'COMPLAINT';
    }

    return null;
}

function extractCandidateEvents(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (!payload || typeof payload !== 'object') {
        return [];
    }

    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.events)) {
        return record.events;
    }

    if (Array.isArray(record.records)) {
        return record.records;
    }

    if (record['event-data'] && typeof record['event-data'] === 'object') {
        return [record['event-data']];
    }

    if (record.msys && typeof record.msys === 'object') {
        return [record.msys];
    }

    return [payload];
}

function normalizeDeliveryWebhookEntries(payload: unknown): NormalizedDeliveryWebhookEntry[] {
    const candidates = extractCandidateEvents(payload);

    return candidates.flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') {
            return [];
        }

        const entry = candidate as Record<string, unknown>;
        const eventType = mapRawDeliveryEventType(getNestedString(entry, [
            ['eventType'],
            ['event_type'],
            ['event'],
            ['RecordType'],
            ['type'],
            ['message_event', 'type']
        ]));

        if (!eventType) {
            return [];
        }

        const messageId = getNestedString(entry, [
            ['messageId'],
            ['message_id'],
            ['MessageID'],
            ['MessageId'],
            ['BouncedMessageID'],
            ['MessageID'],
            ['msg_id'],
            ['smtp-id'],
            ['sg_message_id'],
            ['message', 'headers', 'message-id'],
            ['message', 'headers', 'Message-Id'],
            ['email', 'messageId']
        ])?.replace(/^<|>$/g, '');

        const trackingId = getNestedString(entry, [
            ['trackingId'],
            ['tracking_id'],
            ['custom_args', 'trackingId'],
            ['metadata', 'trackingId'],
            ['mail', 'tracking_id']
        ]);

        const recipientEmail = getNestedString(entry, [
            ['recipientEmail'],
            ['recipient_email'],
            ['email'],
            ['recipient'],
            ['recipientEmailAddress'],
            ['Email'],
            ['email_address'],
            ['rcptTo'],
            ['message', 'rcpt_to'],
            ['envelope', 'to']
        ])?.toLowerCase();

        const emailAccountId = getNestedString(entry, [
            ['emailAccountId'],
            ['email_account_id'],
            ['custom_args', 'emailAccountId'],
            ['metadata', 'emailAccountId']
        ]);

        const reason = getNestedString(entry, [
            ['reason'],
            ['description'],
            ['details'],
            ['error'],
            ['diagnosticCode'],
            ['DiagnosticCode'],
            ['bounce', 'description']
        ]);

        return [{
            emailAccountId,
            eventType,
            reason,
            messageId,
            trackingId,
            recipientEmail
        }];
    });
}

async function authenticateRelayEmailAccount(relayKey: string | undefined, emailAccountId?: string) {
    if (!relayKey) {
        return null;
    }

    if (emailAccountId) {
        const emailAccount = await prisma.emailAccount.findUnique({
            where: { id: emailAccountId }
        });

        if (emailAccount?.relayApiKey) {
            try {
                if (decrypt(emailAccount.relayApiKey) === relayKey) {
                    return emailAccount;
                }
            } catch (error) {
                Logger.warn('Failed to decrypt relay API key during webhook auth', {
                    emailAccountId,
                    error
                });
            }
        }
        return null;
    }

    const accounts = await prisma.emailAccount.findMany({
        where: { relayApiKey: { not: null } }
    });

    for (const account of accounts) {
        try {
            if (account.relayApiKey && decrypt(account.relayApiKey) === relayKey) {
                return account;
            }
        } catch (error) {
            Logger.warn('Failed to decrypt relay API key during webhook auth scan', {
                emailAccountId: account.id,
                error
            });
        }
    }

    return null;
}

async function applyDeliveryEventToLog(params: {
    logId: string;
    accountId: string;
    eventType: 'BOUNCE' | 'COMPLAINT';
    reason?: string;
}) {
    const log = await prisma.emailLog.findFirst({
        where: {
            id: params.logId,
            accountId: params.accountId
        }
    });

    if (!log) {
        return null;
    }

    const existingEvent = await prisma.messageTrackingEvent.findFirst({
        where: {
            emailLogId: log.id,
            eventType: params.eventType
        },
        select: { id: true }
    });

    if (!existingEvent) {
        await prisma.messageTrackingEvent.create({
            data: {
                emailLogId: log.id,
                eventType: params.eventType
            }
        });
    }

    const suppressionScope = 'ALL';
    const suppressionReason = params.reason?.trim()
        || (params.eventType === 'COMPLAINT' ? 'Marked as spam complaint' : 'Marked as email bounce');

    await prisma.emailUnsubscribe.upsert({
        where: {
            accountId_email: {
                accountId: params.accountId,
                email: log.to.toLowerCase()
            }
        },
        create: {
            accountId: params.accountId,
            email: log.to.toLowerCase(),
            scope: suppressionScope,
            reason: suppressionReason
        },
        update: {
            scope: suppressionScope,
            reason: suppressionReason
        }
    });

    const nextStatus = params.eventType === 'COMPLAINT' ? 'COMPLAINED' : 'BOUNCED';
    const updatedLog = await prisma.emailLog.update({
        where: { id: log.id },
        data: {
            status: nextStatus,
            canRetry: false,
            errorMessage: suppressionReason
        }
    });

    return updatedLog;
}

const emailRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post('/delivery-events', async (request, reply) => {
        try {
            const relayKeyHeader = request.headers['x-relay-key'];
            const relayKey = Array.isArray(relayKeyHeader) ? relayKeyHeader[0] : relayKeyHeader;
            const entries = normalizeDeliveryWebhookEntries(request.body);

            if (entries.length === 0) {
                return reply.code(400).send({ error: 'No supported delivery events found in payload' });
            }

            const results: Array<Record<string, unknown>> = [];

            for (const entry of entries) {
                const emailAccount = await authenticateRelayEmailAccount(relayKey, entry.emailAccountId);
                if (!emailAccount) {
                    results.push({
                        success: false,
                        reason: 'INVALID_RELAY_CREDENTIALS',
                        recipientEmail: entry.recipientEmail || null,
                        eventType: entry.eventType
                    });
                    continue;
                }

                const matchClauses = [
                    entry.messageId ? { messageId: entry.messageId } : null,
                    entry.trackingId ? { trackingId: entry.trackingId } : null
                ].filter(Boolean) as Array<Record<string, string>>;

                if (entry.recipientEmail) {
                    matchClauses.push({ to: entry.recipientEmail });
                }

                if (matchClauses.length === 0) {
                    results.push({
                        success: false,
                        reason: 'NO_MATCH_KEYS',
                        accountId: emailAccount.accountId,
                        eventType: entry.eventType
                    });
                    continue;
                }

                const emailLog = await prisma.emailLog.findFirst({
                    where: {
                        accountId: emailAccount.accountId,
                        emailAccountId: emailAccount.id,
                        OR: matchClauses
                    },
                    orderBy: { createdAt: 'desc' }
                });

                if (!emailLog) {
                    results.push({
                        success: false,
                        reason: 'EMAIL_LOG_NOT_FOUND',
                        accountId: emailAccount.accountId,
                        recipientEmail: entry.recipientEmail || null,
                        eventType: entry.eventType
                    });
                    continue;
                }

                const updatedLog = await applyDeliveryEventToLog({
                    logId: emailLog.id,
                    accountId: emailAccount.accountId,
                    eventType: entry.eventType,
                    reason: entry.reason
                });

                Logger.info('Recorded webhook delivery event', {
                    accountId: emailAccount.accountId,
                    emailAccountId: emailAccount.id,
                    emailLogId: emailLog.id,
                    recipientEmail: emailLog.to,
                    eventType: entry.eventType
                });

                results.push({
                    success: true,
                    accountId: emailAccount.accountId,
                    emailAccountId: emailAccount.id,
                    emailLogId: emailLog.id,
                    recipientEmail: emailLog.to,
                    eventType: entry.eventType,
                    status: updatedLog?.status || null
                });
            }

            const processedCount = results.filter((result) => result.success).length;
            return {
                success: processedCount > 0,
                processedCount,
                totalEvents: entries.length,
                results
            };
        } catch (error) {
            Logger.error('Failed to process delivery webhook event', { error });
            return reply.code(500).send({ error: 'Failed to process delivery webhook event' });
        }
    });

    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * List all email accounts with passwords masked.
     */
    fastify.get('/accounts', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const accounts = await prisma.emailAccount.findMany({
                where: { accountId }
            });

            // Mask passwords
            const masked = accounts.map(a => ({
                ...a,
                smtpPassword: a.smtpPassword ? '••••••••' : null,
                imapPassword: a.imapPassword ? '••••••••' : null,
                relayApiKey: a.relayApiKey ? '••••••••' : null
            }));

            return masked;
        } catch (error) {
            Logger.error('Failed to list email accounts', { error });
            return reply.code(500).send({ error: 'Failed to list email accounts' });
        }
    });

    fastify.get('/suppressions', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const suppressions = await prisma.emailUnsubscribe.findMany({
                where: { accountId },
                orderBy: { createdAt: 'desc' }
            });

            return suppressions;
        } catch (error) {
            Logger.error('Failed to list email suppressions', { error });
            return reply.code(500).send({ error: 'Failed to list email suppressions' });
        }
    });

    fastify.post<{ Body: SuppressionBody }>('/suppressions', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const email = request.body.email?.trim().toLowerCase();
            const scope = request.body.scope === 'ALL' ? 'ALL' : 'MARKETING';
            const reason = request.body.reason?.trim() || null;

            if (!email) {
                return reply.code(400).send({ error: 'Email is required' });
            }

            const suppression = await prisma.emailUnsubscribe.upsert({
                where: {
                    accountId_email: {
                        accountId,
                        email
                    }
                },
                create: {
                    accountId,
                    email,
                    scope,
                    reason
                },
                update: {
                    scope,
                    reason
                }
            });

            return suppression;
        } catch (error) {
            Logger.error('Failed to save email suppression', { error });
            return reply.code(500).send({ error: 'Failed to save email suppression' });
        }
    });

    fastify.delete<{ Params: { id: string } }>('/suppressions/:id', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const deleted = await prisma.emailUnsubscribe.deleteMany({
                where: {
                    id: request.params.id,
                    accountId
                }
            });

            if (deleted.count === 0) {
                return reply.code(404).send({ error: 'Suppression not found' });
            }

            return { success: true };
        } catch (error) {
            Logger.error('Failed to delete email suppression', { error });
            return reply.code(500).send({ error: 'Failed to delete email suppression' });
        }
    });

    /**
     * Create a new unified email account.
     */
    fastify.post<{ Body: EmailAccountBody }>('/accounts', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const body = request.body;

            if (!body.name || !body.email) {
                return reply.code(400).send({ error: 'Name and email are required' });
            }

            const account = await prisma.emailAccount.create({
                data: {
                    accountId,
                    name: body.name,
                    email: body.email,
                    // SMTP
                    smtpEnabled: Boolean(body.smtpEnabled),
                    smtpHost: body.smtpHost || null,
                    smtpPort: body.smtpPort ? parseInt(String(body.smtpPort), 10) : null,
                    smtpUsername: body.smtpUsername || null,
                    smtpPassword: body.smtpPassword ? encrypt(body.smtpPassword) : null,
                    smtpSecure: body.smtpSecure ?? true,
                    // IMAP
                    imapEnabled: Boolean(body.imapEnabled),
                    imapHost: body.imapHost || null,
                    imapPort: body.imapPort ? parseInt(String(body.imapPort), 10) : null,
                    imapUsername: body.imapUsername || null,
                    imapPassword: body.imapPassword ? encrypt(body.imapPassword) : null,
                    imapSecure: body.imapSecure ?? true,
                    // HTTP Relay
                    relayEndpoint: body.relayEndpoint || null,
                    relayApiKey: body.relayApiKey ? encrypt(body.relayApiKey) : null
                }
            });

            return {
                ...account,
                smtpPassword: account.smtpPassword ? '••••••••' : null,
                imapPassword: account.imapPassword ? '••••••••' : null,
                relayApiKey: account.relayApiKey ? '••••••••' : null
            };
        } catch (error) {
            Logger.error('Failed to create email account', { error });
            return reply.code(500).send({ error: 'Failed to create email account' });
        }
    });

    /**
     * Update an existing email account.
     */
    fastify.put<{ Params: { id: string }; Body: EmailAccountBody }>('/accounts/:id', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            const { id } = request.params;
            const body = request.body;

            const existing = await prisma.emailAccount.findFirst({
                where: { id, accountId }
            });

            if (!existing) return reply.code(404).send({ error: 'Account not found' });

            const updateData: any = {
                name: body.name,
                email: body.email,
                // SMTP
                smtpEnabled: Boolean(body.smtpEnabled),
                smtpHost: body.smtpHost || null,
                smtpPort: body.smtpPort ? parseInt(String(body.smtpPort), 10) : null,
                smtpUsername: body.smtpUsername || null,
                smtpSecure: body.smtpSecure ?? true,
                // IMAP
                imapEnabled: Boolean(body.imapEnabled),
                imapHost: body.imapHost || null,
                imapPort: body.imapPort ? parseInt(String(body.imapPort), 10) : null,
                imapUsername: body.imapUsername || null,
                imapSecure: body.imapSecure ?? true,
                // HTTP Relay
                relayEndpoint: body.relayEndpoint || null,
                updatedAt: new Date()
            };

            // Only update passwords if changed
            if (body.smtpPassword && body.smtpPassword !== '••••••••') {
                updateData.smtpPassword = encrypt(body.smtpPassword);
            }
            if (body.imapPassword && body.imapPassword !== '••••••••') {
                updateData.imapPassword = encrypt(body.imapPassword);
            }
            if (body.relayApiKey && body.relayApiKey !== '••••••••') {
                updateData.relayApiKey = encrypt(body.relayApiKey);
            }

            const updated = await prisma.emailAccount.update({
                where: { id },
                data: updateData
            });

            return {
                ...updated,
                smtpPassword: updated.smtpPassword ? '••••••••' : null,
                imapPassword: updated.imapPassword ? '••••••••' : null,
                relayApiKey: updated.relayApiKey ? '••••••••' : null
            };
        } catch (error) {
            Logger.error('Failed to update email account', { error });
            return reply.code(500).send({ error: 'Failed to update email account' });
        }
    });

    /**
     * Delete an email account.
     */
    fastify.delete<{ Params: { id: string } }>('/accounts/:id', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            const { id } = request.params;
            const result = await prisma.emailAccount.deleteMany({
                where: { id, accountId }
            });

            if (result.count === 0) return reply.code(404).send({ error: 'Account not found' });
            return { success: true };
        } catch (error) {
            Logger.error('Failed to delete email account', { error });
            return reply.code(500).send({ error: 'Failed to delete account' });
        }
    });

    /**
     * Set an email account as default for sending.
     */
    fastify.patch<{ Params: { id: string } }>('/accounts/:id/default', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            const { id } = request.params;

            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const target = await prisma.emailAccount.findFirst({
                where: { id, accountId }
            });

            if (!target) return reply.code(404).send({ error: 'Email account not found' });

            // Clear default from all accounts, then set this one
            await prisma.$transaction([
                prisma.emailAccount.updateMany({
                    where: { accountId, isDefault: true },
                    data: { isDefault: false }
                }),
                prisma.emailAccount.update({
                    where: { id },
                    data: { isDefault: true }
                })
            ]);

            Logger.info('Set default email account', { accountId, emailAccountId: id });
            return { success: true };
        } catch (error) {
            Logger.error('Failed to set default email account', { error });
            return reply.code(500).send({ error: 'Failed to set default account' });
        }
    });

    /**
     * Test SMTP or IMAP connection.
     */
    fastify.post<{ Body: TestConnectionBody }>('/test', async (request, reply) => {
        try {
            const { id, protocol, host, port, username, password, isSecure } = request.body;
            const accountId = request.user?.accountId || request.accountId;

            let passwordToTest = password;

            // If password is masked, retrieve from database
            if (password === '••••••••' && id && accountId) {
                const existing = await prisma.emailAccount.findFirst({
                    where: { id, accountId }
                });
                if (existing) {
                    const encryptedPwd = protocol === 'SMTP'
                        ? existing.smtpPassword
                        : existing.imapPassword;
                    if (encryptedPwd) {
                        try {
                            passwordToTest = decrypt(encryptedPwd);
                        } catch (e) {
                            Logger.error('Decryption failed for test', { error: e });
                        }
                    }
                }
            }

            const mockAccount = {
                host,
                port: parseInt(String(port)),
                username,
                password: passwordToTest,
                type: protocol,
                isSecure: Boolean(isSecure)
            };

            const success = await emailService.verifyConnection(mockAccount);
            return { success };
        } catch (error: any) {
            Logger.error('Connection test failed', { error: error.message });
            return reply.code(400).send({ success: false, error: error.message });
        }
    });

    /**
     * Test HTTP relay connection with full authentication (real-world test).
     * Sends a test payload to the actual relay endpoint to verify API key works.
     * If emailAccountId is provided, uses the stored encrypted key from DB.
     */
    fastify.post<{ Body: { relayEndpoint: string; relayApiKey?: string; emailAccountId?: string; testEmail?: string } }>('/test-relay', async (request, reply) => {
        try {
            const { relayEndpoint, relayApiKey, emailAccountId, testEmail } = request.body;
            const accountId = request.user?.accountId || request.accountId;

            if (!relayEndpoint) {
                return reply.code(400).send({ success: false, error: 'Relay endpoint is required' });
            }

            // SSRF protection: Only allow HTTPS URLs
            if (!relayEndpoint.startsWith('https://')) {
                return reply.code(400).send({ success: false, error: 'Relay endpoint must use HTTPS' });
            }

            // Validate URL format
            try {
                new URL(relayEndpoint);
            } catch {
                return reply.code(400).send({ success: false, error: 'Invalid URL format' });
            }

            // Get the API key - either from DB (for existing accounts) or from request (for new accounts)
            let apiKeyToUse = relayApiKey;

            // If the key is masked or not provided, try to get from DB
            if (!apiKeyToUse || apiKeyToUse === '••••••••') {
                if (!emailAccountId) {
                    return reply.code(400).send({ success: false, error: 'Please enter the API key to test the connection' });
                }

                const emailAccount = await prisma.emailAccount.findFirst({
                    where: { id: emailAccountId, accountId }
                });

                if (!emailAccount?.relayApiKey) {
                    return reply.code(400).send({ success: false, error: 'No API key found for this account. Please enter one.' });
                }

                apiKeyToUse = decrypt(emailAccount.relayApiKey);
            }

            // Use the actual relay endpoint with test mode flag
            const testPayload = {
                account_id: accountId,
                to: testEmail || 'test@example.com',
                subject: '[OverSeek Test] Relay Connection Test',
                html: '<p>This is a test email to verify the HTTP relay connection is working.</p>',
                from_name: 'OverSeek Test',
                from_email: process.env.CONTACT_EMAIL || 'noreply@localhost',
                test_mode: true // Tell WP plugin this is just a test, don't actually send
            };

            const response = await fetch(relayEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Relay-Key': apiKeyToUse,
                    'Accept': 'application/json'
                },
                body: JSON.stringify(testPayload)
            });

            const responseData = await response.json().catch(() => ({}));

            if (response.ok) {
                return {
                    success: true,
                    message: 'Relay connection test successful! API key authenticated.',
                    data: responseData
                };
            } else if (response.status === 401 || response.status === 403) {
                return { success: false, error: 'API key authentication failed. Check your relay API key.' };
            } else {
                return {
                    success: false,
                    error: `Relay returned status ${response.status}: ${responseData.message || responseData.code || 'Unknown error'}`
                };
            }
        } catch (error: any) {
            Logger.error('Relay test failed', { error: error.message });
            return reply.code(400).send({ success: false, error: error.message });
        }
    });

    /**
     * Manually sync all IMAP-enabled accounts.
     */
    fastify.post('/sync', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const imapAccounts = await prisma.emailAccount.findMany({
                where: { accountId, imapEnabled: true }
            });

            if (imapAccounts.length === 0) {
                return { success: true, message: 'No IMAP accounts configured', checked: 0 };
            }

            let checked = 0;
            const errors: string[] = [];

            for (const acc of imapAccounts) {
                try {
                    await emailService.checkEmails(acc.id);
                    checked++;
                } catch (e: any) {
                    Logger.error('Manual sync error', { emailAccountId: acc.id, error: e });
                    errors.push(`${acc.email}: ${e.message}`);
                }
            }

            return {
                success: true,
                checked,
                total: imapAccounts.length,
                errors: errors.length > 0 ? errors : undefined
            };
        } catch (error: any) {
            Logger.error('Sync error', { error });
            return reply.code(500).send({ error: 'Failed to sync emails' });
        }
    });

    /**
     * Get email sending logs.
     */
    fastify.get<{ Querystring: { limit?: string; offset?: string } }>('/logs', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const limit = Math.min(parseInt(request.query.limit || '50', 10), 100);
            const offset = parseInt(request.query.offset || '0', 10);

            const [logs, total] = await Promise.all([
                prisma.emailLog.findMany({
                    where: { accountId },
                    orderBy: { createdAt: 'desc' },
                    take: limit,
                    skip: offset,
                    include: {
                        emailAccount: {
                            select: { name: true, email: true }
                        },
                        trackingEvents: {
                            where: {
                                eventType: { in: ['BOUNCE', 'COMPLAINT'] }
                            },
                            select: {
                                id: true,
                                eventType: true,
                                createdAt: true
                            },
                            orderBy: { createdAt: 'desc' }
                        }
                    }
                }),
                prisma.emailLog.count({ where: { accountId } })
            ]);

            return { logs, total, limit, offset };
        } catch (error: any) {
            Logger.error('Failed to fetch email logs', { error });
            return reply.code(500).send({ error: 'Failed to fetch email logs' });
        }
    });

    /**
     * Retry a failed email.
     */
    fastify.post<{ Params: { id: string } }>('/logs/:id/retry', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { id } = request.params;

            const result = await emailService.retryFailedEmail(id, accountId);

            if (!result.success) {
                return reply.code(400).send({ success: false, error: result.error });
            }

            Logger.info('Email retry successful', { emailLogId: id, messageId: result.messageId });
            return { success: true, messageId: result.messageId };
        } catch (error: any) {
            Logger.error('Failed to retry email', { error });
            return reply.code(500).send({ error: 'Failed to retry email' });
        }
    });

    fastify.post<{ Params: { id: string }; Body: DeliveryEventBody }>('/logs/:id/delivery-event', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const eventType = request.body.eventType;
            if (eventType !== 'BOUNCE' && eventType !== 'COMPLAINT') {
                return reply.code(400).send({ error: 'Invalid delivery event type' });
            }

            const updatedLog = await applyDeliveryEventToLog({
                logId: request.params.id,
                accountId,
                eventType,
                reason: request.body.reason
            });

            if (!updatedLog) {
                return reply.code(404).send({ error: 'Email log not found' });
            }

            Logger.info('Recorded email delivery event', {
                accountId,
                emailLogId: updatedLog.id,
                recipient: updatedLog.to,
                eventType
            });

            return {
                success: true,
                log: updatedLog
            };
        } catch (error) {
            Logger.error('Failed to record delivery event', { error });
            return reply.code(500).send({ error: 'Failed to record delivery event' });
        }
    });
};

export default emailRoutes;
