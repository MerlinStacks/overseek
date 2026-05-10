import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { SuppressionBodySchema } from './schemas';
import { getEmailAccountIdOrReply, parseBodyOrReply } from './routeHelpers';

function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

function normalizeScope(scope?: string) {
    return scope === 'ALL' ? 'ALL' : 'MARKETING';
}

const emailSuppressionRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/suppressions', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        try {
            return await prisma.emailUnsubscribe.findMany({
                where: { accountId },
                orderBy: { createdAt: 'desc' }
            });
        } catch (error: any) {
            Logger.error('Failed to list email suppressions', { error });
            return reply.code(500).send({ error: 'Failed to list email suppressions' });
        }
    });

    fastify.post('/suppressions', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        const parsed = parseBodyOrReply(reply, SuppressionBodySchema.safeParse(request.body));
        if (!parsed) return;
        const { email, scope, reason } = parsed;
        if (!email) return reply.code(400).send({ error: 'Email is required' });
        try {
            const normalizedEmail = normalizeEmail(email);
            const normalizedScope = normalizeScope(scope);
            return await prisma.emailUnsubscribe.upsert({
                where: { accountId_email: { accountId, email: normalizedEmail } },
                create: { accountId, email: normalizedEmail, scope: normalizedScope, reason: reason?.trim() || null },
                update: { scope: normalizedScope, reason: reason?.trim() || null }
            });
        } catch (error: any) {
            Logger.error('Failed to save email suppression', { error });
            return reply.code(500).send({ error: 'Failed to save email suppression' });
        }
    });

    fastify.delete('/suppressions/:id', async (request, reply) => {
        const accountId = getEmailAccountIdOrReply(request, reply);
        if (!accountId) return;
        const { id } = request.params as { id: string };
        try {
            const deleted = await prisma.emailUnsubscribe.deleteMany({ where: { id, accountId } });
            if (deleted.count === 0) return reply.code(404).send({ error: 'Suppression not found' });
            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to delete email suppression', { error });
            return reply.code(500).send({ error: 'Failed to delete email suppression' });
        }
    });
};

export default emailSuppressionRoutes;
