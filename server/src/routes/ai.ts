/**
 * AI Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { AIService } from '../services/ai';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

const aiRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/models', async (request, reply) => {
        try {
            const accountId = request.headers['x-account-id'] as string;
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
            Logger.error('Models Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch models' });
        }
    });

    fastify.post<{ Body: { message: string, context?: any } }>('/chat', async (request, reply) => {
        try {
            const { message, context } = request.body;
            const accountId = request.headers['x-account-id'] as string;

            if (!message) return reply.code(400).send({ error: 'Message required' });
            if (!accountId) return reply.code(400).send({ error: 'Account ID required header' });

            const response = await AIService.generateResponse(message, accountId, context);
            return response;
        } catch (error) {
            Logger.error('AI Error', { error });
            return reply.code(500).send({ error: 'Failed to generate response' });
        }
    });
};

export default aiRoutes;
