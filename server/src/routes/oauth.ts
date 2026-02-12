/**
 * OAuth Routes - Fastify Plugin
 * Composite plugin combining platform-specific OAuth flows.
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { buildCallbackUrl, getApiBase } from './oauthHelpers';

// Import sub-plugins
import oauthGoogleRoutes from './oauthGoogle';
import oauthMetaRoutes from './oauthMeta';
import oauthTikTokRoutes from './oauthTikTok';
import oauthSearchConsoleRoutes from './oauthSearchConsole';

const oauthRoutes: FastifyPluginAsync = async (fastify) => {
    // Mount platform-specific OAuth routes as nested plugins
    await fastify.register(oauthGoogleRoutes);          // /google/authorize, /google/callback
    await fastify.register(oauthMetaRoutes);            // /meta/exchange, /meta/messaging/...
    await fastify.register(oauthTikTokRoutes);          // /tiktok/authorize, /tiktok/callback
    await fastify.register(oauthSearchConsoleRoutes);   // /search-console/authorize, /search-console/callback

    // ──────────────────────────────────────────────────────────────
    // CALLBACK URLS — single source of truth for all platforms
    // ──────────────────────────────────────────────────────────────

    /**
     * GET /callback-urls — Return the canonical callback/webhook URLs for
     * every OAuth platform.  The frontend displays these to the user so they
     * can register them in each provider's developer console.
     *
     * Why: When API_URL is set (e.g. behind a reverse proxy), the origin the
     * browser sees differs from the origin the server actually uses in OAuth
     * redirects.  Fetching from the server eliminates the mismatch.
     */
    fastify.get('/callback-urls', { preHandler: requireAuthFastify }, async (request) => {
        return {
            google: buildCallbackUrl(request, 'google/callback'),
            metaAds: buildCallbackUrl(request, 'meta/ads/callback'),
            metaMessaging: buildCallbackUrl(request, 'meta/messaging/callback'),
            tiktok: buildCallbackUrl(request, 'tiktok/callback'),
            searchConsole: buildCallbackUrl(request, 'search-console/callback'),
            metaWebhook: `${getApiBase(request)}/api/meta-webhook`,
        };
    });

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
