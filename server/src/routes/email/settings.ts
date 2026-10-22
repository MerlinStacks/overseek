import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify } from '../../middleware/auth';
import { PermissionService } from '../../services/PermissionService';
import { AuditActions, AuditService } from '../../services/AuditService';

const defaults = { bounceTrackingEnabled: false, maxSendPerSecond: 1, maxSendPerDay: 6000, version: 'default' };
const schema = z.object({ bounceTrackingEnabled: z.boolean(), maxSendPerSecond: z.number().int().min(1).max(1000), maxSendPerDay: z.number().int().min(1).max(1000000), version: z.union([z.literal('default'), z.string().datetime()]) }).strict();
const emailSettingsRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
        if (!await PermissionService.hasPermission(request.user.id, request.accountId, request.method === 'GET' ? 'view_email_settings' : 'manage_email_settings')) return reply.code(403).send({ error: 'Email settings permission required' });
    });
    fastify.get('/settings', async request => {
        const settings = await prisma.emailSettings.findUnique({ where: { accountId: request.accountId! } });
        return settings ? { ...settings, version: settings.updatedAt.toISOString() } : defaults;
    });
    fastify.post('/settings', async (request, reply) => {
        const parsed = schema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'Valid limits and current version required' });
        const { version, ...data } = parsed.data, accountId = request.accountId!;
        try {
            const updated = await prisma.$transaction(async tx => {
                if (version === 'default') return tx.emailSettings.create({ data: { accountId, ...data } });
                const changed = await tx.emailSettings.updateMany({ where: { accountId, updatedAt: new Date(version) }, data: { ...data, updatedAt: new Date(Math.max(Date.now(), Date.parse(version) + 1)) } });
                if (changed.count !== 1) throw Object.assign(new Error('Settings changed'), { statusCode: 409 });
                return tx.emailSettings.findUniqueOrThrow({ where: { accountId } });
            });
            await AuditService.log(accountId, request.user!.id, AuditActions.EMAIL_SETTINGS_UPDATED, 'EMAIL_SETTINGS', updated.id, data);
            return { success: true, settings: { ...updated, version: updated.updatedAt.toISOString() } };
        } catch (error) {
            if ((error as { code?: string }).code === 'P2002' || (error as { statusCode?: number }).statusCode === 409) return reply.code(409).send({ error: 'Settings changed; reload before writing' });
            throw error;
        }
    });
};
export default emailSettingsRoutes;
