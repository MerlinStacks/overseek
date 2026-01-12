/**
 * Sessions Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

const sessionsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // GET /api/sessions - List all active sessions for current user
    fastify.get('/', async (request, reply) => {
        try {
            const userId = request.user?.id;
            const currentSessionId = request.user?.sessionId;
            if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

            const sessions = await prisma.refreshToken.findMany({
                where: {
                    userId,
                    revokedAt: null,
                    expiresAt: { gt: new Date() }
                },
                select: {
                    id: true,
                    createdAt: true,
                    expiresAt: true,
                    ipAddress: true,
                    userAgent: true
                },
                orderBy: { createdAt: 'desc' }
            });

            // Mark the current session based on sessionId from JWT
            const sessionsWithCurrent = sessions.map(s => ({
                ...s,
                isCurrent: s.id === currentSessionId
            }));

            return sessionsWithCurrent;
        } catch (error) {
            Logger.error('Failed to fetch sessions', { error });
            return reply.code(500).send({ error: 'Failed to fetch sessions' });
        }
    });

    // DELETE /api/sessions/:id - Revoke specific session
    fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
        try {
            const userId = request.user?.id;
            const { id } = request.params;

            if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

            const token = await prisma.refreshToken.findFirst({
                where: { id, userId }
            });

            if (!token) {
                return reply.code(404).send({ error: 'Session not found' });
            }

            await prisma.refreshToken.update({
                where: { id },
                data: { revokedAt: new Date() }
            });

            Logger.info('Session revoked', { userId, sessionId: id });
            return { success: true };
        } catch (error) {
            Logger.error('Failed to revoke session', { error });
            return reply.code(500).send({ error: 'Failed to revoke session' });
        }
    });

    // DELETE /api/sessions - Revoke all sessions except current
    fastify.delete('/', async (request, reply) => {
        try {
            const userId = request.user?.id;
            const currentSessionId = request.user?.sessionId;
            if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

            // Exclude the current session from revocation to prevent self-logout
            const result = await prisma.refreshToken.updateMany({
                where: {
                    userId,
                    revokedAt: null,
                    ...(currentSessionId ? { id: { not: currentSessionId } } : {})
                },
                data: { revokedAt: new Date() }
            });

            Logger.info('All other sessions revoked', { userId, currentSessionId, count: result.count });
            return { success: true, revokedCount: result.count };
        } catch (error) {
            Logger.error('Failed to revoke all sessions', { error });
            return reply.code(500).send({ error: 'Failed to revoke sessions' });
        }
    });
};

export default sessionsRoutes;
