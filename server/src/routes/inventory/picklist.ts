import { FastifyPluginAsync } from 'fastify';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { PicklistService } from '../../services/PicklistService';
import { PermissionService } from '../../services/PermissionService';
import { z } from 'zod';

const picklistService = new PicklistService();

const picklistRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/picklist', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
        if (!await PermissionService.hasPermission(request.user.id, accountId, 'view_orders')) return reply.code(403).send({ error: 'Order view permission required' });
        const parsed = z.object({ status: z.enum(['processing', 'on-hold', 'pending', 'completed']).optional(), limit: z.string().regex(/^[1-9]\d*$/).transform(Number).refine(value => value <= 500).optional() }).strict().safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: 'Use a supported status and integer limit from 1 to 500' });
        try {
            return await picklistService.generatePicklist(accountId, {
                status: parsed.data.status,
                limit: parsed.data.limit
            });
        } catch (error: any) {
            Logger.error('Error generating picklist', { error });
            return reply.code(500).send({ error: 'Failed to generate picklist' });
        }
    });
};

export default picklistRoutes;
