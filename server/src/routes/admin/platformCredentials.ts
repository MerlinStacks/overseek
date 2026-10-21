import { type FastifyPluginAsync, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify, requireSuperAdminFastify } from '../../middleware/auth';
import { platformEmailService } from '../../services/PlatformEmailService';
import { clearCredentialsCache } from '../../services/ads/types';
import webpush from 'web-push';

const fields: Record<string, string[]> = {
    PLATFORM_SMTP: ['host', 'port', 'username', 'password', 'fromEmail', 'fromName', 'secure'],
    GOOGLE_ADS: ['clientId', 'clientSecret', 'developerToken', 'loginCustomerId'], GOOGLE_SEARCH_CONSOLE: ['clientId', 'clientSecret'], GOOGLE_CUSTOM_SEARCH: ['apiKey', 'searchEngineId'],
    META_ADS: ['appId', 'appSecret'], META: ['appId', 'appSecret'], META_MESSAGING: ['appId', 'appSecret', 'webhookVerifyToken'],
    TIKTOK_MESSAGING: ['clientKey', 'clientSecret', 'webhookVerifyToken'], WEB_PUSH_VAPID: ['publicKey', 'privateKey'],
};
const publicFields = new Set(['host', 'port', 'username', 'fromEmail', 'fromName', 'secure', 'clientId', 'loginCustomerId', 'appId', 'publicKey', 'searchEngineId', 'clientKey']);
const platformSchema = z.string().refine(value => Object.hasOwn(fields, value));
const bodySchema = z.object({ credentials: z.record(z.string(), z.string().max(8000)), notes: z.string().max(4000).optional() }).strict();
const promptIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);
const promptBody = z.object({ content: z.string().trim().min(1).max(100000), name: z.string().trim().min(1).max(200).optional() }).strict();
const object = (value: unknown): Record<string, string> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {};
const masked = (value: unknown) => Object.fromEntries(Object.entries(object(value)).map(([key, item]) => [key, publicFields.has(key) && typeof item === 'string' ? item : '********']));
const safeRecord = (record: { credentials: unknown }) => ({ ...record, credentials: masked(record.credentials) });
const isMask = (value: string) => value === '••••••••' || /\*{8}$/.test(value);
async function invalidateCredentials(platform: string) {
    clearCredentialsCache();
    if (platform === 'GOOGLE_CUSTOM_SEARCH') (await import('../../services/search-console/SerpCheckService')).SerpCheckService.clearCache();
    if (platform === 'WEB_PUSH_VAPID') (await import('../../services/PushNotificationService')).PushNotificationService.clearCredentialsCache();
}
function validateFields(platform: string, values: Record<string, string>) {
    if (platform === 'PLATFORM_SMTP') {
        if (values.port && (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535)) throw new Error('SMTP port must be an integer from 1 to 65535');
        if (values.secure && !['true', 'false'].includes(values.secure)) throw new Error('SMTP secure must be true or false');
        if (values.fromEmail && !z.email().safeParse(values.fromEmail).success) throw new Error('Invalid sender email');
        if (values.host && !/^[a-zA-Z0-9.-]+$/.test(values.host)) throw new Error('Invalid SMTP host');
    }
    if (values.loginCustomerId && !/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/.test(values.loginCustomerId)) throw new Error('Invalid Google manager account ID');
    if (values.appId && !/^\d+$/.test(values.appId)) throw new Error('Meta app ID must contain digits only');
    if (platform === 'WEB_PUSH_VAPID' && Object.entries(values).some(([key, value]) => !/^[A-Za-z0-9_-]+$/.test(value) || Buffer.from(value, 'base64url').length !== (key === 'publicKey' ? 65 : 32))) throw new Error('Invalid VAPID key format');
}
function failure(reply: FastifyReply, error: unknown) {
    if ((error as { code?: string })?.code === 'P2025') return reply.code(404).send({ error: 'Configuration not found' });
    return reply.code(500).send({ error: 'Configuration operation failed' });
}
export const platformCredentialsRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify); fastify.addHook('preHandler', requireSuperAdminFastify);
    fastify.get('/platform-credentials', async (_request, reply) => {
        reply.header('Cache-Control', 'no-store');
        try { return (await prisma.platformCredentials.findMany({ orderBy: { platform: 'asc' } })).map(safeRecord); }
        catch (error) { return failure(reply, error); }
    });
    fastify.get<{ Params: { platform: string } }>('/platform-credentials/:platform', async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (!platformSchema.safeParse(request.params.platform).success) return reply.code(400).send({ error: 'Unsupported platform' });
        try { const record = await prisma.platformCredentials.findUnique({ where: { platform: request.params.platform } }); return record ? safeRecord(record) : reply.code(404).send({ error: 'Platform credentials not found' }); }
        catch (error) { return failure(reply, error); }
    });
    fastify.put<{ Params: { platform: string } }>('/platform-credentials/:platform', async (request, reply) => {
        const platform = request.params.platform; const parsed = bodySchema.safeParse(request.body);
        if (!platformSchema.safeParse(platform).success || !parsed.success || Object.keys(parsed.data.credentials).some(key => !fields[platform].includes(key))) return reply.code(400).send({ error: 'Invalid platform credential fields' });
        try {
            let record: Awaited<ReturnType<typeof prisma.platformCredentials.upsert>>;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    record = await prisma.$transaction(async tx => {
                        const previous = await tx.platformCredentials.findUnique({ where: { platform } });
                        const values = { ...object(previous?.credentials) };
                        for (const [key, input] of Object.entries(parsed.data.credentials)) {
                            if (!input.trim()) continue; // Empty inputs mean unchanged, never erase a stored secret.
                            if (isMask(input)) {
                                if (!values[key] || !(input === '********' || input === '••••••••' || input === `${values[key].slice(0, 4)}********`)) throw Object.assign(new Error('Masked fields cannot create or replace credentials'), { statusCode: 400 });
                                continue;
                            }
                            values[key] = input.trim();
                        }
                        try { validateFields(platform, values); } catch (error) { throw Object.assign(error, { statusCode: 400 }); }
                        if (!Object.keys(values).length) throw Object.assign(new Error('At least one credential value is required'), { statusCode: 400 });
                        return tx.platformCredentials.upsert({ where: { platform }, create: { platform, credentials: values, notes: parsed.data.notes }, update: { credentials: values, ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}) } });
                    }, { isolationLevel: 'Serializable' });
                    break;
                } catch (error) { if (attempt === 2 || !['P2034', 'P2002'].includes((error as { code?: string })?.code)) throw error; }
            }
            await invalidateCredentials(platform); reply.header('Cache-Control', 'no-store'); return safeRecord(record!);
        } catch (error) { if ((error as { statusCode?: number })?.statusCode === 400) return reply.code(400).send({ error: (error as Error).message }); return failure(reply, error); }
    });
    fastify.delete<{ Params: { platform: string } }>('/platform-credentials/:platform', async (request, reply) => {
        if (!platformSchema.safeParse(request.params.platform).success) return reply.code(400).send({ error: 'Unsupported platform' });
        try { await prisma.platformCredentials.delete({ where: { platform: request.params.platform } }); await invalidateCredentials(request.params.platform); return { success: true }; }
        catch (error) { return failure(reply, error); }
    });
    fastify.post('/platform-smtp/test', async (request, reply) => {
        const parsed = z.object({ host: z.string().trim().min(1).max(255).regex(/^[a-zA-Z0-9.-]+$/), port: z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(1).max(65535)), username: z.string().trim().min(1).max(500), password: z.string().min(1).max(8000), secure: z.boolean().optional() }).strict().safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid SMTP settings' });
        try {
            let password = parsed.data.password;
            if (isMask(password)) {
                const saved = object((await prisma.platformCredentials.findUnique({ where: { platform: 'PLATFORM_SMTP' } }))?.credentials);
                if (!saved.password || !['********', '••••••••', `${saved.password.slice(0, 4)}********`].includes(password)) return reply.code(400).send({ error: 'Stored SMTP password unavailable' });
                password = saved.password;
            }
            const result = await platformEmailService.testConnection({ host: parsed.data.host, port: parsed.data.port, username: parsed.data.username, password, secure: parsed.data.secure });
            return result.success ? { success: true } : reply.code(400).send({ success: false, error: 'SMTP connection failed. Verify the settings.' });
        } catch { return reply.code(500).send({ error: 'SMTP test failed' }); }
    });
    fastify.post('/generate-vapid-keys', async (_request, reply) => {
        try {
            let record = await prisma.platformCredentials.findUnique({ where: { platform: 'WEB_PUSH_VAPID' } });
            let alreadyExists = !!record;
            if (!record) {
                const keys = webpush.generateVAPIDKeys();
                try { record = await prisma.platformCredentials.create({ data: { platform: 'WEB_PUSH_VAPID', credentials: keys, notes: 'Generated via Admin UI' } }); }
                catch (error) { if ((error as { code?: string })?.code !== 'P2002') throw error; record = await prisma.platformCredentials.findUnique({ where: { platform: 'WEB_PUSH_VAPID' } }); alreadyExists = true; }
            }
            const values = object(record?.credentials);
            if (!values.publicKey || !values.privateKey) return reply.code(409).send({ error: 'Existing VAPID configuration is incomplete. Inspect it before changing keys.' });
            await invalidateCredentials('WEB_PUSH_VAPID'); return { publicKey: values.publicKey, alreadyExists, message: alreadyExists ? 'Existing VAPID keys retained.' : 'VAPID keys created.' };
        } catch (error) { return failure(reply, error); }
    });
    fastify.get('/ai-prompts', async (_request, reply) => {
        try { return (await prisma.aIPrompt.findMany({ orderBy: { promptId: 'asc' } })).map(prompt => ({ id: prompt.promptId, name: prompt.name, content: prompt.content, updatedAt: prompt.updatedAt })); }
        catch (error) { return failure(reply, error); }
    });
    fastify.get<{ Params: { promptId: string } }>('/ai-prompts/:promptId', async (request, reply) => {
        if (!promptIdSchema.safeParse(request.params.promptId).success) return reply.code(400).send({ error: 'Invalid prompt ID' });
        try { const prompt = await prisma.aIPrompt.findUnique({ where: { promptId: request.params.promptId } }); return prompt ? { id: prompt.promptId, name: prompt.name, content: prompt.content, updatedAt: prompt.updatedAt } : reply.code(404).send({ error: 'Prompt not found' }); }
        catch (error) { return failure(reply, error); }
    });
    fastify.put<{ Params: { promptId: string } }>('/ai-prompts/:promptId', async (request, reply) => {
        const parsed = promptBody.safeParse(request.body);
        if (!promptIdSchema.safeParse(request.params.promptId).success || !parsed.success) return reply.code(400).send({ error: 'Invalid prompt fields' });
        try { const prompt = await prisma.aIPrompt.upsert({ where: { promptId: request.params.promptId }, create: { promptId: request.params.promptId, content: parsed.data.content, name: parsed.data.name }, update: parsed.data }); return { id: prompt.promptId, name: prompt.name, content: prompt.content, updatedAt: prompt.updatedAt }; }
        catch (error) { return failure(reply, error); }
    });
    fastify.delete<{ Params: { promptId: string } }>('/ai-prompts/:promptId', async (request, reply) => {
        if (!promptIdSchema.safeParse(request.params.promptId).success) return reply.code(400).send({ error: 'Invalid prompt ID' });
        try { await prisma.aIPrompt.delete({ where: { promptId: request.params.promptId } }); return { success: true }; }
        catch (error) { return failure(reply, error); }
    });
};
