import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { SuppressionBodySchema } from './schemas';

const emailSuppressionRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/suppressions', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });
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
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });
        const parse = SuppressionBodySchema.safeParse(request.body);
        if (!parse.success) {
            return reply.code(400).send({ error: 'Invalid input', issues: parse.error.flatten() });
        }
        const { email, scope, reason } = parse.data;
        if (!email) return reply.code(400).send({ error: 'Email is required' });
        try {
            return await prisma.emailUnsubscribe.upsert({
                where: { accountId_email: { accountId, email: email.trim().toLowerCase() } },
                create: { accountId, email: email.trim().toLowerCase(), scope: scope === 'ALL' ? 'ALL' : 'MARKETING', reason: reason?.trim() || null },
                update: { scope: scope === 'ALL' ? 'ALL' : 'MARKETING', reason: reason?.trim() || null }
            });
        } catch (error: any) {
            Logger.error('Failed to save email suppression', { error });
            return reply.code(500).send({ error: 'Failed to save email suppression' });
        }
    });

    fastify.delete('/suppressions/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });
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
