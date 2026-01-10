/**
 * Email Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { EmailService } from '../services/EmailService';
import { requireAuthFastify } from '../middleware/auth';
import { encrypt, decrypt } from '../utils/encryption';

const emailService = new EmailService();

interface EmailAccountBody {
    name?: string;
    email?: string;
    host: string;
    port: string | number;
    username: string;
    password: string;
    type?: string;
    isSecure?: boolean;
}

const emailRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // List Accounts
    fastify.get('/accounts', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const accounts = await prisma.emailAccount.findMany({
                where: { accountId }
            });

            const masked = accounts.map(a => ({
                ...a,
                password: '••••••••'
            }));

            return masked;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to list email accounts' });
        }
    });

    // Create Account
    fastify.post<{ Body: EmailAccountBody }>('/accounts', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const { name, email, host, port, username, password, type, isSecure } = request.body;

            if (!host || !port || !username || !password) {
                return reply.code(400).send({ error: 'Missing required fields' });
            }

            const account = await prisma.emailAccount.create({
                data: {
                    accountId,
                    name,
                    email,
                    host,
                    port: parseInt(String(port)),
                    username,
                    password: encrypt(password),
                    type,
                    isSecure: Boolean(isSecure)
                }
            });

            return { ...account, password: '••••••••' };
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to create email account' });
        }
    });

    // Update Account
    fastify.put<{ Params: { id: string }; Body: EmailAccountBody }>('/accounts/:id', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            const { id } = request.params;
            const data = request.body;

            const existing = await prisma.emailAccount.findFirst({
                where: { id, accountId }
            });

            if (!existing) return reply.code(404).send({ error: 'Account not found' });

            const updateData: any = {
                name: data.name,
                email: data.email,
                host: data.host,
                port: data.port ? parseInt(String(data.port)) : undefined,
                username: data.username,
                type: data.type,
                isSecure: Boolean(data.isSecure),
                updatedAt: new Date()
            };

            if (data.password && data.password !== '••••••••') {
                updateData.password = encrypt(data.password);
            }

            const updated = await prisma.emailAccount.update({
                where: { id },
                data: updateData
            });

            return { ...updated, password: '••••••••' };
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to update email account' });
        }
    });

    // Delete Account
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
            return reply.code(500).send({ error: 'Failed to delete account' });
        }
    });

    // Test Connection
    fastify.post<{ Body: EmailAccountBody & { id?: string } }>('/test', async (request, reply) => {
        try {
            const { id, host, port, username, password, type, isSecure } = request.body;
            const accountId = request.user?.accountId || request.accountId;

            let passwordToTest = password;

            if (password === '••••••••' && id && accountId) {
                const existing = await prisma.emailAccount.findFirst({
                    where: { id, accountId }
                });
                if (existing?.password) {
                    try {
                        passwordToTest = decrypt(existing.password);
                    } catch (e) {
                        Logger.error('Decryption failed for test', { error: e });
                    }
                }
            }

            const mockAccount: any = {
                host,
                port: parseInt(String(port)),
                username,
                password: passwordToTest,
                type,
                isSecure: Boolean(isSecure)
            };

            const success = await emailService.verifyConnection(mockAccount);
            return { success };
        } catch (error: any) {
            return reply.code(400).send({ success: false, error: error.message });
        }
    });

    // Manual Sync
    fastify.post('/sync', async (request, reply) => {
        try {
            const accountId = request.user?.accountId || request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const imapAccounts = await prisma.emailAccount.findMany({
                where: { accountId, type: 'IMAP' }
            });

            if (imapAccounts.length === 0) {
                return { success: true, message: 'No IMAP accounts configured', checked: 0 };
            }

            let checked = 0;
            let errors: string[] = [];

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

    // Get Email Logs
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
};

export default emailRoutes;
