import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { isAccountFeatureEnabled } from '../utils/accountFeatures';
import { getAdsAccountIdOrReply, parsePositiveInt } from './ads/routeHelpers';
import { AiManagerService } from '../services/ai/AiManagerService';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

const aiManagerRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/health', async (request, reply) => {
        try {
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const enabled = await isAccountFeatureEnabled(accountId, 'AI_MANAGER', false);
            if (!enabled) {
                return reply.code(403).send({ error: 'AI Manager is not enabled for this account' });
            }

            const [searchConsoleCount, googleAdsCount, metaAdsCount] = await Promise.all([
                prisma.searchConsoleAccount.count({ where: { accountId } }),
                prisma.adAccount.count({ where: { accountId, platform: 'GOOGLE' } }),
                prisma.adAccount.count({ where: { accountId, platform: 'META' } }),
            ]);

            return {
                searchConsoleConnected: searchConsoleCount > 0,
                googleAdsConnected: googleAdsCount > 0,
                metaAdsConnected: metaAdsCount > 0,
            };
        } catch (error) {
            Logger.error('[AiManagerRoutes] Failed to fetch source health', { error });
            return reply.code(500).send({ error: 'Failed to fetch source health' });
        }
    });

    fastify.get('/suggestions', async (request, reply) => {
        try {
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const enabled = await isAccountFeatureEnabled(accountId, 'AI_MANAGER', false);
            if (!enabled) {
                return reply.code(403).send({ error: 'AI Manager is not enabled for this account' });
            }

            const query = request.query as { status?: string; limit?: string };
            const limit = Math.min(parsePositiveInt(query.limit, 50), 100);

            const items = await prisma.recommendationLog.findMany({
                where: {
                    accountId,
                    recommendationId: { startsWith: 'ai_manager_' },
                    ...(query.status ? { status: query.status } : {}),
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
            });

            return {
                items: items.map((item) => ({
                    id: item.id,
                    title: item.campaignName || 'AI suggestion',
                    text: item.text,
                    type: item.category,
                    source: item.platform || 'COMBINED',
                    priority: item.priority,
                    confidence: item.confidenceScore,
                    status: item.status,
                    createdAt: item.createdAt,
                    dataPoints: Array.isArray(item.dataPoints) ? item.dataPoints : [],
                }))
            };
        } catch (error) {
            Logger.error('[AiManagerRoutes] Failed to fetch suggestions', { error });
            return reply.code(500).send({ error: 'Failed to fetch suggestions' });
        }
    });

    fastify.post('/suggestions/refresh', async (request, reply) => {
        try {
            const accountId = getAdsAccountIdOrReply(request, reply);
            if (!accountId) return;

            const enabled = await isAccountFeatureEnabled(accountId, 'AI_MANAGER', false);
            if (!enabled) {
                return reply.code(403).send({ error: 'AI Manager is not enabled for this account' });
            }

            const result = await AiManagerService.generateSuggestions(accountId);
            return result;
        } catch (error) {
            Logger.error('[AiManagerRoutes] Failed to refresh suggestions', { error });
            return reply.code(500).send({ error: 'Failed to refresh suggestions' });
        }
    });

    fastify.post<{ Params: { id: string }; Body: { status: 'implemented' | 'dismissed' } }>(
        '/suggestions/:id/status',
        async (request, reply) => {
            try {
                const accountId = getAdsAccountIdOrReply(request, reply);
                if (!accountId) return;

                const enabled = await isAccountFeatureEnabled(accountId, 'AI_MANAGER', false);
                if (!enabled) {
                    return reply.code(403).send({ error: 'AI Manager is not enabled for this account' });
                }

                const { id } = request.params;
                const { status } = request.body;

                if (!['implemented', 'dismissed'].includes(status)) {
                    return reply.code(400).send({ error: 'Invalid status' });
                }

                const existing = await prisma.recommendationLog.findFirst({
                    where: { id, accountId, recommendationId: { startsWith: 'ai_manager_' } },
                    select: { id: true },
                });

                if (!existing) {
                    return reply.code(404).send({ error: 'Suggestion not found' });
                }

                await prisma.recommendationLog.update({
                    where: { id },
                    data: {
                        status,
                        implementedAt: status === 'implemented' ? new Date() : null,
                        dismissedAt: status === 'dismissed' ? new Date() : null,
                    }
                });

                return { success: true };
            } catch (error) {
                Logger.error('[AiManagerRoutes] Failed to update suggestion status', { error });
                return reply.code(500).send({ error: 'Failed to update suggestion status' });
            }
        }
    );
};

export default aiManagerRoutes;
