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

const emailRoutes: FastifyPluginAsync = async (fastify) => {
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
                    smtpPort: body.smtpPort ? parseInt(String(body.smtpPort)) : null,
                    smtpUsername: body.smtpUsername || null,
                    smtpPassword: body.smtpPassword ? encrypt(body.smtpPassword) : null,
                    smtpSecure: body.smtpSecure ?? true,
                    // IMAP
                    imapEnabled: Boolean(body.imapEnabled),
                    imapHost: body.imapHost || null,
                    imapPort: body.imapPort ? parseInt(String(body.imapPort)) : null,
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
                smtpPort: body.smtpPort ? parseInt(String(body.smtpPort)) : null,
                smtpUsername: body.smtpUsername || null,
                smtpSecure: body.smtpSecure ?? true,
                // IMAP
                imapEnabled: Boolean(body.imapEnabled),
                imapHost: body.imapHost || null,
                imapPort: body.imapPort ? parseInt(String(body.imapPort)) : null,
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
                from_email: 'noreply@overseek.com.au',
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

            const limit = Math.min(parseInt(request.query.limit || '50'), 100);
            const offset = parseInt(request.query.offset || '0');

            const [logs, total] = await Promise.all([
                prisma.emailLog.findMany({
                    where: { accountId },
                    orderBy: { createdAt: 'desc' },
                    take: limit,
                    skip: offset,
                    include: {
                        emailAccount: {
                            select: { name: true, email: true }
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
};

export default emailRoutes;
