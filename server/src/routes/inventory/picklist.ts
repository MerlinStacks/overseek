import { FastifyPluginAsync } from 'fastify';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { PicklistService } from '../../services/PicklistService';

const picklistService = new PicklistService();

const picklistRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/picklist', async (request, reply) => {
        const accountId = request.accountId!;
        const { status, limit } = request.query as { status?: string; limit?: string };
        const parsedLimit = limit === undefined ? undefined : Number(limit);
        if (parsedLimit !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit <= 0 || !Number.isInteger(parsedLimit))) {
            return reply.code(400).send({ error: 'limit must be a positive integer' });
        }
        try {
            return await picklistService.generatePicklist(accountId, {
                status,
                limit: parsedLimit
            });
        } catch (error: any) {
            Logger.error('Error generating picklist', { error });
            return reply.code(500).send({ error: 'Failed to generate picklist' });
        }
    });
};

export default picklistRoutes;
