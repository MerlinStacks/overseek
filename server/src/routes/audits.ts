/**
 * Audits Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { AuditService } from '../services/AuditService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';

const paginationSchema = {
    type: 'object',
    properties: {
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 }
    },
    additionalProperties: false
};
type Pagination = { limit: number; page: number };

const auditsRoutes: FastifyPluginAsync = async (fastify) => {
    // Get logs for a specific resource
    fastify.get<{ Params: { resource: string; resourceId: string }; Querystring: Pagination }>(
        '/:resource/:resourceId',
        { preHandler: [requireAuthFastify], schema: { querystring: paginationSchema } },
        async (request, reply) => {
            try {
                const { resource, resourceId } = request.params;
                const accountId = request.accountId;

                if (!accountId) {
                    return reply.code(400).send({ error: 'No account context provided' });
                }

                const { limit, page } = request.query;
                const logs = await AuditService.getLogsForResource(accountId, resource.toUpperCase(), resourceId, limit, (page - 1) * limit);
                return logs;
            } catch (error) {
                Logger.error('Failed to fetch audit logs', { error });
                return reply.code(500).send({ error: 'Failed to fetch audit logs' });
            }
        }
    );

    // Get recent logs for the account
    fastify.get<{ Querystring: Pagination }>('/recent', { preHandler: [requireAuthFastify], schema: { querystring: paginationSchema } }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account context provided' });
            const { limit, page } = request.query;

            const logs = await AuditService.getRecentLogs(accountId, limit, (page - 1) * limit);
            return logs;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to fetch recent audit logs' });
        }
    });
};

export const auditsRouter = auditsRoutes;
export default auditsRoutes;
