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
        try {
            return await picklistService.generatePicklist(accountId, {
                status,
                limit: limit ? Number(limit) : undefined
            });
        } catch (error: any) {
            Logger.error('Error generating picklist', { error });
            return reply.code(500).send({ error: 'Failed to generate picklist' });
        }
    });
};

export default picklistRoutes;
