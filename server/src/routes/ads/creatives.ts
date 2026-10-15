import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { MetaCreativeService } from '../../services/ads/MetaCreativeService';
import { CreativeReviewService } from '../../services/ads/CreativeReviewService';
import { AIRequestError } from '../../services/ai/OpenRouterClient';
import { getAdsAccountIdOrReply } from './routeHelpers';

const numericId = { type: 'string', pattern: '^\\d+$', maxLength: 40 };
const daysSchema = { type: 'integer', minimum: 1, maximum: 365, default: 30 };

export const creativeRoutes: FastifyPluginAsync = async fastify => {
    async function resolveAccount(request: any, reply: any) {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return null;
        const connected = await prisma.adAccount.findFirst({
            where: { id: request.params.adAccountId, accountId }, select: { id: true, platform: true }
        });
        if (!connected) { reply.code(404).send({ error: 'Ad account not found' }); return null; }
        if (connected.platform !== 'META') { reply.code(400).send({ error: 'Creative analysis requires a Meta Ads account' }); return null; }
        return accountId;
    }

    fastify.get<{
        Params: { adAccountId: string }; Querystring: { adsetId: string; days: number };
    }>('/:adAccountId/creatives', {
        schema: { querystring: { type: 'object', required: ['adsetId'], additionalProperties: false, properties: { adsetId: numericId, days: daysSchema } } }
    }, async (request, reply) => {
        try {
            if (!await resolveAccount(request, reply)) return;
            return await MetaCreativeService.getReport(request.params.adAccountId, request.query.adsetId, request.query.days);
        } catch (error) {
            Logger.error('Failed to fetch creative report', { error });
            return reply.code(502).send({ error: 'Meta creative data could not be loaded. Please retry or check your Meta permissions.' });
        }
    });

    fastify.post<{
        Params: { adAccountId: string };
        Body: { adsetId: string; creativeId: string; days: number; includeVisuals: boolean };
    }>('/:adAccountId/creative-review', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
        schema: { body: {
            type: 'object', required: ['adsetId', 'creativeId'], additionalProperties: false,
            properties: {
                adsetId: numericId, creativeId: { type: 'string', pattern: '^(\\d+|unavailable-\\d+)$', maxLength: 60 },
                days: daysSchema, includeVisuals: { type: 'boolean', default: false }
            }
        } }
    }, async (request, reply) => {
        try {
            const accountId = await resolveAccount(request, reply);
            if (!accountId) return;
            const { adsetId, creativeId, days, includeVisuals } = request.body;
            return await CreativeReviewService.review(accountId, request.params.adAccountId, adsetId, creativeId, days, includeVisuals);
        } catch (error) {
            if (error instanceof AIRequestError) return reply.code(error.statusCode).send({ error: error.message });
            Logger.error('Failed to review creative', { error });
            return reply.code(502).send({ error: 'Creative review could not be completed. Please retry.' });
        }
    });
};
