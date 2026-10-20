import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { FeedMappingService, type VariationMode } from '../services/feedMapping';
import { Logger } from '../utils/logger';
import { recordFeedExport } from '../services/feedHealth';

const paramsSchema = z.object({
    accountId: z.string().min(1),
    channel: z.string().min(1),
});

const querySchema = z.object({
    token: z.string().min(1),
    variationMode: z.enum([
        'automatic',
        'variable_parent',
        'all_variations',
        'default_variation',
        'first_variation',
        'last_variation',
        'variable_and_variations',
    ]).optional().default('automatic'),
});

function recordExportBestEffort(accountId: string, channel: ReturnType<typeof FeedMappingService.parseChannel>, mode: VariationMode, succeeded: boolean): void {
    // Telemetry must never delay or fail a valid feed when Redis is unavailable.
    void recordFeedExport(accountId, channel, mode, succeeded).catch(() => {
        Logger.error('Failed to record local feed export status', { accountId, channel });
    });
}

const feedExportRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get<{ Params: { accountId: string; channel: string }; Querystring: { token: string; variationMode?: VariationMode } }>(
        '/export/:accountId/:channel',
        async (request, reply) => {
            let validExport: { accountId: string; channel: ReturnType<typeof FeedMappingService.parseChannel>; variationMode: VariationMode } | undefined;
            try {
                const { accountId, channel } = paramsSchema.parse(request.params);
                const { token, variationMode } = querySchema.parse(request.query);

                const isValidToken = await FeedMappingService.validateFeedExportToken(accountId, channel, token);
                if (!isValidToken) {
                    return reply.code(403).send({ error: 'Invalid feed export token' });
                }

                const parsedChannel = FeedMappingService.parseChannel(channel);
                validExport = { accountId, channel: parsedChannel, variationMode };
                if (parsedChannel === 'meta') {
                    const csv = await FeedMappingService.getFeedExportCsv(accountId, parsedChannel, variationMode);
                    recordExportBestEffort(accountId, parsedChannel, variationMode, true);
                    return reply.type('text/csv; charset=utf-8').send(csv);
                }

                const xml = await FeedMappingService.getFeedExportXml(accountId, parsedChannel, variationMode);
                recordExportBestEffort(accountId, parsedChannel, variationMode, true);
                return reply.type('application/xml; charset=utf-8').send(xml);
            } catch (error: any) {
                if (validExport) recordExportBestEffort(validExport.accountId, validExport.channel, validExport.variationMode, false);
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
