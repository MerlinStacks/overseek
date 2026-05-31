import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { encrypt } from '../../utils/encryption';
import { EmailAccountBodySchema, TestConnectionBodySchema, TestRelayBodySchema } from './schemas';
import { EmailService } from '../../services/EmailService';
import { decrypt } from '../../utils/encryption';
import { getEmailAccountIdOrReply, parseBodyOrReply } from './routeHelpers';

const emailService = new EmailService();

function maskPasswords<T extends { smtpPassword?: string | null; imapPassword?: string | null; relayApiKey?: string | null }>(
    account: T
) {
    return {
        ...account,
        smtpPassword: account.smtpPassword ? '••••••••' : null,
        imapPassword: account.imapPassword ? '••••••••' : null,
        relayApiKey: account.relayApiKey ? '••••••••' : null,
    };
}

function buildEmailAccountBaseData(body: any) {
    return {
        name: body.name,
        email: body.email,
        smtpEnabled: Boolean(body.smtpEnabled),
        smtpHost: body.smtpHost || null,
        smtpPort: body.smtpPort ? parseInt(String(body.smtpPort), 10) : null,
        smtpUsername: body.smtpUsername || null,
        smtpSecure: body.smtpSecure ?? true,
        imapEnabled: Boolean(body.imapEnabled),
        imapHost: body.imapHost || null,
        imapPort: body.imapPort ? parseInt(String(body.imapPort), 10) : null,
        imapUsername: body.imapUsername || null,
        imapSecure: body.imapSecure ?? true,
        relayEndpoint: body.relayEndpoint || null,
        relayProfileId: body.relayProfileId || null,
    };
}

function maybeEncryptSecret(value?: string | null) {
    if (!value || value === '••••••••') return undefined;
    return encrypt(value);
}

function parseHttpsUrlOrReply(relayEndpoint: string, reply: any): URL | null {
    if (!relayEndpoint.startsWith('https://')) {
        reply.code(400).send({ success: false, error: 'Relay endpoint must use HTTPS' });
        return null;
    }
    try {
        return new URL(relayEndpoint);
    } catch {
        reply.code(400).send({ success: false, error: 'Invalid URL format' });
        return null;
    }
}

async function resolveTestPassword(
    accountId: string | undefined,
    protocol: string,
    id: string | undefined,
    password: string,
) {
    if (password !== '••••••••' || !id || !accountId) {
        return password;
    }

    const existing = await prisma.emailAccount.findFirst({ where: { id, accountId } });
    if (!existing) return password;

    const encryptedPwd = protocol === 'SMTP' ? existing.smtpPassword : existing.imapPassword;
    if (!encryptedPwd) return password;

    try {
        return decrypt(encryptedPwd);
    } catch (error) {
        Logger.error('Decryption failed for test', { error });
        return password;
    }
}

const emailAccountRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/accounts', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        try {
            const accounts = await prisma.emailAccount.findMany({ where: { accountId } });
            return accounts.map(maskPasswords);
        } catch (error: any) {
            Logger.error('Failed to list email accounts', { error });
            return reply.code(500).send({ error: 'Failed to list email accounts' });
        }
    });

    fastify.post('/accounts', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        const body = parseBodyOrReply(reply, EmailAccountBodySchema.safeParse(request.body));
        if (!body) return;
        if (!body.name || !body.email) {
            return reply.code(400).send({ error: 'Name and email are required' });
        }
        try {
            const baseData = buildEmailAccountBaseData(body);
            const account = await prisma.emailAccount.create({
                data: {
                    accountId,
                    ...baseData,
                    smtpPassword: body.smtpPassword ? encrypt(body.smtpPassword) : null,
                    imapPassword: body.imapPassword ? encrypt(body.imapPassword) : null,
                    relayApiKey: body.relayApiKey ? encrypt(body.relayApiKey) : null,
                }
            });
            return maskPasswords(account);
        } catch (error: any) {
            Logger.error('Failed to create email account', { error });
            return reply.code(500).send({ error: 'Failed to create email account' });
        }
    });

    fastify.put('/accounts/:id', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        const { id } = request.params as { id: string };
        const body = parseBodyOrReply(reply, EmailAccountBodySchema.safeParse(request.body));
        if (!body) return;
        const existing = await prisma.emailAccount.findFirst({ where: { id, accountId } });
        if (!existing) return reply.code(404).send({ error: 'Account not found' });

        const updateData: any = {
            ...buildEmailAccountBaseData(body),
            updatedAt: new Date(),
        };

        const smtpPassword = maybeEncryptSecret(body.smtpPassword);
        if (smtpPassword) updateData.smtpPassword = smtpPassword;
        const imapPassword = maybeEncryptSecret(body.imapPassword);
        if (imapPassword) updateData.imapPassword = imapPassword;
        const relayApiKey = maybeEncryptSecret(body.relayApiKey);
        if (relayApiKey) updateData.relayApiKey = relayApiKey;

        try {
            const updated = await prisma.emailAccount.update({ where: { id }, data: updateData });
            return maskPasswords(updated);
        } catch (error: any) {
            Logger.error('Failed to update email account', { error });
            return reply.code(500).send({ error: 'Failed to update email account' });
        }
    });

    fastify.delete('/accounts/:id', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        const { id } = request.params as { id: string };
        try {
            const result = await prisma.emailAccount.deleteMany({ where: { id, accountId } });
            if (result.count === 0) return reply.code(404).send({ error: 'Account not found' });
            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to delete email account', { error });
            return reply.code(500).send({ error: 'Failed to delete account' });
        }
    });

    fastify.patch('/accounts/:id/default', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        const { id } = request.params as { id: string };
        const target = await prisma.emailAccount.findFirst({ where: { id, accountId } });
        if (!target) return reply.code(404).send({ error: 'Email account not found' });
        if (!target.smtpEnabled && !target.relayEndpoint) {
            return reply.code(400).send({ error: 'Default email account must be configured for sending' });
        }
        try {
            await prisma.$transaction([
                prisma.emailAccount.updateMany({ where: { accountId, isDefault: true }, data: { isDefault: false } }),
                prisma.emailAccount.update({ where: { id }, data: { isDefault: true } })
            ]);
            Logger.info('Set default email account', { accountId, emailAccountId: id });
            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to set default email account', { error });
            return reply.code(500).send({ error: 'Failed to set default account' });
        }
    });

    fastify.post('/test', async (request, reply) => {
        const accountId = request.accountId;
        const parsed = parseBodyOrReply(reply, TestConnectionBodySchema.safeParse(request.body));
        if (!parsed) return;
        const { id, protocol, host, port, username, password, isSecure } = parsed;
        const passwordToTest = await resolveTestPassword(accountId, protocol, id, password);
        const mockAccount = {
            host,
            port: parseInt(String(port)),
            username,
            password: passwordToTest,
            type: protocol,
            isSecure: Boolean(isSecure)
        };
        try {
            const success = await emailService.verifyConnection(mockAccount);
            return { success };
        } catch (error: any) {
            Logger.error('Connection test failed', { error: error.message });
            return reply.code(400).send({ success: false, error: error.message });
        }
    });

    fastify.post('/test-relay', async (request, reply) => {
        const accountId = request.accountId;
        const parsed = parseBodyOrReply(reply, TestRelayBodySchema.safeParse(request.body));
        if (!parsed) return;
        const { relayEndpoint, relayApiKey, relayProfileId, emailAccountId, testEmail } = parsed;
        const parsedUrl = parseHttpsUrlOrReply(relayEndpoint, reply);
        if (!parsedUrl) return;
        let apiKeyToUse = relayApiKey;
        if (!apiKeyToUse || apiKeyToUse === '••••••••') {
            if (!emailAccountId || !accountId) {
                return reply.code(400).send({ success: false, error: 'Please enter the API key to test the connection' });
            }
            const emailAccount = await prisma.emailAccount.findFirst({ where: { id: emailAccountId, accountId } });
            if (!emailAccount?.relayApiKey) {
                return reply.code(400).send({ success: false, error: 'No API key found for this account. Please enter one.' });
            }
            apiKeyToUse = decrypt(emailAccount.relayApiKey);
        }
        const testPayload = {
            account_id: accountId,
            to: testEmail || 'test@example.com',
            subject: '[OverSeek Test] Relay Connection Test',
            html: '<p>This is a test email to verify the HTTP relay connection is working.</p>',
            from_name: 'OverSeek Test',
            from_email: process.env.CONTACT_EMAIL || 'noreply@localhost',
            relay_profile_id: relayProfileId || undefined,
            test_mode: true
        };
        try {
            const response = await fetch(parsedUrl.toString(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Relay-Key': apiKeyToUse!,
                    'Accept': 'application/json'
                },
                body: JSON.stringify(testPayload)
            });
            const responseData = await response.json().catch(() => ({}));
            if (response.ok) {
                return { success: true, message: 'Relay connection test successful! API key authenticated.', data: responseData };
            } else if (response.status === 401 || response.status === 403) {
                return { success: false, error: 'API key authentication failed. Check your relay API key.' };
            } else {
                return { success: false, error: `Relay returned status ${response.status}: ${responseData.message || responseData.code || 'Unknown error'}` };
            }
        } catch (error: any) {
            Logger.error('Relay test failed', { error: error.message });
            return reply.code(400).send({ success: false, error: error.message });
        }
    });
};

export default emailAccountRoutes;
