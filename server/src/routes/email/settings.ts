import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { AuditActions, AuditService } from '../../services/AuditService';
import { getEmailAccountIdOrReply, parseBodyOrReply } from './routeHelpers';
import { EmailSettingsBodySchema } from './schemas';

const emailSettingsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/settings', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const settings = await prisma.emailSettings.upsert({
                where: { accountId },
                update: {},
                create: {
                    accountId,
                    bounceTrackingEnabled: false,
                    maxSendPerSecond: 1,
                    maxSendPerDay: 6000,
                },
            });

            return settings;
        } catch (error) {
            Logger.error('Failed to fetch email settings', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch email settings' });
        }
    });

    fastify.post('/settings', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;

        const body = parseBodyOrReply(reply, EmailSettingsBodySchema.safeParse(request.body));
        if (!body) return;

        try {
            const updated = await prisma.emailSettings.upsert({
                where: { accountId },
                update: {
                    bounceTrackingEnabled: body.bounceTrackingEnabled,
                    maxSendPerSecond: body.maxSendPerSecond,
                    maxSendPerDay: body.maxSendPerDay,
                },
                create: {
                    accountId,
                    bounceTrackingEnabled: body.bounceTrackingEnabled,
                    maxSendPerSecond: body.maxSendPerSecond,
                    maxSendPerDay: body.maxSendPerDay,
                },
            });

            await AuditService.log(
                accountId,
                request.user?.id || null,
                AuditActions.EMAIL_SETTINGS_UPDATED,
                'EMAIL_SETTINGS',
                updated.id,
                {
                    bounceTrackingEnabled: updated.bounceTrackingEnabled,
                    maxSendPerSecond: updated.maxSendPerSecond,
                    maxSendPerDay: updated.maxSendPerDay,
                }
            );

            return { success: true, settings: updated };
        } catch (error) {
            Logger.error('Failed to update email settings', { error, accountId });
            return reply.code(500).send({ error: 'Failed to update email settings' });
        }
    });
};

export default emailSettingsRoutes;
