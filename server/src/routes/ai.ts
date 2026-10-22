/**
 * AI Route - Fastify Plugin
 */

import type { FastifyPluginAsync } from 'fastify';
import { AIService } from '../services/ai';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

const aiRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/models', async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId || !request.user?.id) return reply.code(400).send({ error: 'Selected account required' });
            await AIService.authorize(accountId, request.user.id);
            let apiKey = '';

            if (accountId) {
                const account = await prisma.account.findUnique({
                    where: { id: accountId },
                    select: { openRouterApiKey: true }
                });
                if (account?.openRouterApiKey) {
                    apiKey = account.openRouterApiKey;
                }
            }

            const models = await AIService.getModels(apiKey);
            return models;
        } catch (error) {
            Logger.warn('Model list unavailable');
            return reply.code((error as { statusCode?: number })?.statusCode === 403 ? 403 : 503).send({ error: 'Models unavailable or not authorized' });
        }
    });

    fastify.post<{ Body: { message: string, context?: any } }>('/chat', async (request, reply) => {
        try {
            if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body) ||
                typeof request.body.message !== 'string' || !request.body.message.trim()) {
                return reply.code(400).send({ error: 'Message required' });
            }

            const { message, context } = request.body;
            const accountId = request.accountId;

            if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

            const response = await AIService.generateResponse(message, accountId, context, request.user?.id);
            return response;
        } catch (error) {
            const status = (error as { statusCode?: number })?.statusCode;
            Logger.warn('AI request unavailable');
            return reply.code((error as Error)?.name === 'ZodError' ? 400 : status === 403 || status === 429 ? status : 503).send({ error: 'Analysis unavailable, invalid or not authorized' });
        }
    });
};

export default aiRoutes;
