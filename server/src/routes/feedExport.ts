import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FeedMappingService, type VariationMode } from '../services/feedMapping';
import { Logger } from '../utils/logger';

const paramsSchema = z.object({
    accountId: z.string().min(1),
    channel: z.string().min(1),
});

const querySchema = z.object({
    token: z.string().min(1),
    variationMode: z.enum([
        'variable_parent',
        'all_variations',
        'default_variation',
        'first_variation',
        'last_variation',
        'variable_and_variations',
    ]).optional().default('all_variations'),
});

const feedExportRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get<{ Params: { accountId: string; channel: string }; Querystring: { token: string; variationMode?: VariationMode } }>(
        '/export/:accountId/:channel',
        async (request, reply) => {
            try {
                const { accountId, channel } = paramsSchema.parse(request.params);
                const { token, variationMode } = querySchema.parse(request.query);

                const isValidToken = await FeedMappingService.validateFeedExportToken(accountId, channel, token);
                if (!isValidToken) {
                    return reply.code(403).send({ error: 'Invalid feed export token' });
                }

                const xml = await FeedMappingService.getFeedExportXml(accountId, channel, variationMode);
                return reply.type('application/xml; charset=utf-8').send(xml);
            } catch (error: any) {
                Logger.error('Failed to export feed xml', { error: error?.message || error });
                const isBadRequest = error?.message === 'Unsupported feed channel';
                return reply.code(isBadRequest ? 400 : 500).send({
                    error: isBadRequest ? error.message : 'Failed to export feed XML',
                });
            }
        },
    );
};

export default feedExportRoutes;
