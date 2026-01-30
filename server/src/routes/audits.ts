/**
 * Audits Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { AuditService } from '../services/AuditService';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';

const auditsRoutes: FastifyPluginAsync = async (fastify) => {
    // Get logs for a specific resource
    fastify.get<{ Params: { resource: string; resourceId: string } }>(
        '/:resource/:resourceId',
        { preHandler: [requireAuthFastify] },
        async (request, reply) => {
            try {
                const { resource, resourceId } = request.params;
                const accountId = request.accountId;

                if (!accountId) {
                    return reply.code(400).send({ error: 'No account context provided' });
                }

                const logs = await AuditService.getLogsForResource(accountId, resource.toUpperCase(), resourceId);
                return logs;
            } catch (error) {
                Logger.error('Failed to fetch audit logs', { error });
                return reply.code(500).send({ error: 'Failed to fetch audit logs' });
            }
        }
    );

    // Get recent logs for the account
    fastify.get('/recent', { preHandler: [requireAuthFastify] }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account context provided' });
            const query = request.query as { limit?: string };
            const limit = query.limit ? parseInt(query.limit) : 50;

            const logs = await AuditService.getRecentLogs(accountId, limit);
            return logs;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to fetch recent audit logs' });
        }
    });
};

export const auditsRouter = auditsRoutes;
export default auditsRoutes;
