/**
 * OAuth Routes - Fastify Plugin
 * Composite plugin combining platform-specific OAuth flows.
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

// Import sub-plugins
import oauthGoogleRoutes from './oauthGoogle';
import oauthMetaRoutes from './oauthMeta';
import oauthTikTokRoutes from './oauthTikTok';

const oauthRoutes: FastifyPluginAsync = async (fastify) => {
    // Mount platform-specific OAuth routes as nested plugins
    await fastify.register(oauthGoogleRoutes);    // /google/authorize, /google/callback
    await fastify.register(oauthMetaRoutes);      // /meta/exchange, /meta/messaging/...
    await fastify.register(oauthTikTokRoutes);    // /tiktok/authorize, /tiktok/callback

    // ──────────────────────────────────────────────────────────────
    // SOCIAL ACCOUNTS API
    // ──────────────────────────────────────────────────────────────

    /**
     * GET /social-accounts
     * List all connected social messaging accounts.
     */
    fastify.get('/social-accounts', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;

            const socialAccounts = await prisma.socialAccount.findMany({
                where: { accountId, isActive: true },
                select: {
                    id: true,
                    platform: true,
                    name: true,
                    externalId: true,
                    tokenExpiry: true,
                    createdAt: true,
                },
            });

            return { socialAccounts };
        } catch (error: any) {
            Logger.error('Failed to list social accounts', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * DELETE /social-accounts/:id
     * Disconnect a social messaging account.
     */
    fastify.delete<{ Params: { id: string } }>('/social-accounts/:id', { preHandler: requireAuthFastify }, async (request, reply) => {
        try {
            const accountId = request.accountId;
            const { id } = request.params;

            await prisma.socialAccount.updateMany({
                where: { id, accountId },
                data: { isActive: false },
            });

            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to disconnect social account', { error });
            return reply.code(500).send({ error: error.message });
        }
    });
};

export default oauthRoutes;
