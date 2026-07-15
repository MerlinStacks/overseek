import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuthFastify } from '../middleware/auth';
import { isAccountFeatureEnabled } from '../utils/accountFeatures';
import { FeedMappingService, FEED_FEATURE_KEY } from '../services/feedMapping';
import { Logger } from '../utils/logger';
import { QueueFactory, QUEUES } from '../services/queue/QueueFactory';

const paramsSchema = z.object({
    channel: z.string().min(1),
});

const rowParamsSchema = z.object({
    channel: z.string().min(1),
    wooId: z.coerce.number().int().positive(),
});

const listQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(200).default(50),
    q: z.string().optional().default(''),
    variationMode: z.enum([
        'variable_parent',
        'all_variations',
        'default_variation',
        'first_variation',
        'last_variation',
        'variable_and_variations',
    ]).optional().default('all_variations'),
});

const refsQuerySchema = z.object({
    q: z.string().optional().default(''),
    variationMode: z.enum([
        'variable_parent',
        'all_variations',
        'default_variation',
        'first_variation',
        'last_variation',
        'variable_and_variations',
    ]).optional().default('all_variations'),
});

const saveMappingsSchema = z.object({
    mappings: z.array(z.object({
        targetField: z.string().min(1),
        sourceField: z.string().min(1),
        fallbackSourceField: z.string().min(1).optional(),
        required: z.boolean().optional(),
    })).min(1),
});

const saveOverridesSchema = z.object({
    fields: z.record(z.string(), z.string().nullable()),
});

const refreshModeBodySchema = z.object({
    refreshMode: z.enum(['manual', 'auto_on_sync', '1h', '3h', '12h', '24h']),
});

const optimizeRowSchema = z.object({
    fields: z.array(z.string().min(1)).min(1),
    variationWooId: z.coerce.number().int().positive().optional(),
});

const optimizeBulkSchema = z.object({
    fields: z.array(z.string().min(1)).min(1),
    rows: z.array(z.object({
        wooId: z.coerce.number().int().positive(),
        variationWooId: z.coerce.number().int().positive().optional(),
    })).min(1).max(200),
});

const bulkLimitBodySchema = z.object({
    maxBulkOptimizeRows: z.coerce.number().int().min(1).max(200000),
});

const productTypeCategoryPriorityBodySchema = z.object({
    productTypeCategoryPriority: z.array(z.string().trim().min(1).max(200)).max(500),
});

const feedsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) {
            return reply.code(400).send({ error: 'Account context required' });
        }

        const enabled = await isAccountFeatureEnabled(accountId, FEED_FEATURE_KEY, false);
        if (!enabled) {
            return reply.code(403).send({ error: 'Feed exports feature is disabled for this account' });
        }
    });

    fastify.get<{ Params: { channel: string } }>('/mappings/:channel', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { channel } = paramsSchema.parse(request.params);
            const parsedChannel = FeedMappingService.parseChannel(channel);
            const mappings = await FeedMappingService.getMappings(accountId, parsedChannel);
            return { channel: parsedChannel, mappings };
        } catch (error: any) {
            Logger.error('Failed to fetch feed mappings', { error: error?.message || error });
            const status = error?.message === 'Unsupported feed channel' ? 400 : 500;
            return reply.code(status).send({ error: status === 400 ? error.message : 'Failed to fetch mappings' });
        }
    });

    fastify.get('/refresh-modes/options', async () => {
        return { options: FeedMappingService.getRefreshModeOptions() };
    });

    fastify.get('/google-product-categories/options', async (_request, reply) => {
        try {
            const options = await FeedMappingService.getGoogleProductCategoryOptions();
            return { options };
        } catch (error: any) {
            Logger.error('Failed to fetch Google product categories', { error: error?.message || error });
            return reply.code(502).send({ error: 'Failed to fetch Google product categories' });
        }
    });

    fastify.get<{ Params: { channel: string } }>('/refresh-mode/:channel', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { channel } = paramsSchema.parse(request.params);
            const parsedChannel = FeedMappingService.parseChannel(channel);
            const refreshMode = await FeedMappingService.getRefreshMode(accountId, parsedChannel);
            return { channel: parsedChannel, refreshMode };
        } catch (error: any) {
            Logger.error('Failed to fetch feed refresh mode', { error: error?.message || error });
            const status = error?.message === 'Unsupported feed channel' ? 400 : 500;
            return reply.code(status).send({ error: status === 400 ? error.message : 'Failed to fetch refresh mode' });
        }
    });

    fastify.put<{ Params: { channel: string }; Body: { refreshMode: 'manual' | 'auto_on_sync' | '1h' | '3h' | '12h' | '24h' } }>(
        '/refresh-mode/:channel',
        async (request, reply) => {
            try {
                const accountId = request.accountId!;
                const { channel } = paramsSchema.parse(request.params);
                const { refreshMode } = refreshModeBodySchema.parse(request.body);
                const parsedChannel = FeedMappingService.parseChannel(channel);
                const saved = await FeedMappingService.setRefreshMode(accountId, parsedChannel, refreshMode);
                return { channel: parsedChannel, refreshMode: saved };
            } catch (error: any) {
                Logger.error('Failed to save feed refresh mode', { error: error?.message || error });
                const isBadRequest = error?.message === 'Unsupported feed channel' || error?.message === 'Unsupported feed refresh mode';
                return reply.code(isBadRequest ? 400 : 500).send({
                    error: isBadRequest ? error.message : 'Failed to save refresh mode',
                });
            }
        },
    );

    fastify.put<{ Params: { channel: string }; Body: { mappings: unknown[] } }>('/mappings/:channel', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { channel } = paramsSchema.parse(request.params);
            const { mappings } = saveMappingsSchema.parse(request.body);
            const parsedChannel = FeedMappingService.parseChannel(channel);
            const saved = await FeedMappingService.saveMappings(accountId, parsedChannel, mappings);
            return { channel: parsedChannel, mappings: saved };
        } catch (error: any) {
            Logger.error('Failed to save feed mappings', { error: error?.message || error });
            const status = error?.message === 'Unsupported feed channel' ? 400 : 500;
            return reply.code(status).send({ error: status === 400 ? error.message : 'Failed to save mappings' });
        }
    });

    fastify.get<{ Params: { channel: string } }>('/:channel/rows', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { channel } = paramsSchema.parse(request.params);
            const { page, limit, q, variationMode } = listQuerySchema.parse(request.query);
            const parsedChannel = FeedMappingService.parseChannel(channel);
            const result = await FeedMappingService.getFeedRows(accountId, parsedChannel, page, limit, q, variationMode);
            return {
                channel: parsedChannel,
                page,
                limit,
                variationMode,
                total: result.total,
                mappings: result.mappings,
                rows: result.rows,
            };
        } catch (error: any) {
            Logger.error('Failed to fetch feed rows', { error: error?.message || error });
            const status = error?.message === 'Unsupported feed channel' ? 400 : 500;
            return reply.code(status).send({ error: status === 400 ? error.message : 'Failed to fetch feed rows' });
        }
    });

    fastify.get<{ Params: { channel: string; wooId: string } }>('/:channel/products/:wooId', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { channel, wooId } = rowParamsSchema.parse(request.params);
            const parsedChannel = FeedMappingService.parseChannel(channel);
            const result = await FeedMappingService.getFeedRows(
                accountId,
                parsedChannel,
                1,
                1_000_000,
                '',
                'variable_and_variations',
                wooId,
            );

            if (result.total === 0) {
                return reply.code(404).send({ error: 'Product not found' });
            }

            return {
                channel: parsedChannel,
                mappings: result.mappings,
                rows: result.rows,
            };
        } catch (error: any) {
            Logger.error('Failed to fetch product feed rows', { error: error?.message || error });
            const status = error?.message === 'Unsupported feed channel' ? 400 : 500;
            return reply.code(status).send({ error: status === 400 ? error.message : 'Failed to fetch product feed rows' });
        }
    });

    fastify.get<{ Params: { channel: string } }>('/:channel/row-refs', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { channel } = paramsSchema.parse(request.params);
            const { q, variationMode } = refsQuerySchema.parse(request.query);
            const parsedChannel = FeedMappingService.parseChannel(channel);
            const result = await FeedMappingService.getFeedRowRefs(accountId, parsedChannel, q, variationMode);
            return {
                channel: parsedChannel,
                variationMode,
                total: result.total,
                rows: result.rows,
            };
        } catch (error: any) {
            Logger.error('Failed to fetch feed row refs', { error: error?.message || error });
            const status = error?.message === 'Unsupported feed channel' ? 400 : 500;
            return reply.code(status).send({ error: status === 400 ? error.message : 'Failed to fetch row refs' });
        }
    });

    fastify.put<{ Params: { channel: string; wooId: string }; Body: { fields: Record<string, string | null> } }>(
        '/:channel/rows/:wooId',
        async (request, reply) => {
            try {
                const accountId = request.accountId!;
                const { channel, wooId } = rowParamsSchema.parse(request.params);
                const { fields } = saveOverridesSchema.parse(request.body);
                const parsedChannel = FeedMappingService.parseChannel(channel);
                await FeedMappingService.saveRowOverrides(accountId, parsedChannel, wooId, fields as Record<string, string | null>);
                return { success: true };
            } catch (error: any) {
                Logger.error('Failed to save feed row overrides', { error: error?.message || error });
                if (error?.message === 'Product not found') {
                    return reply.code(404).send({ error: 'Product not found' });
                }
                const status = error?.message === 'Unsupported feed channel' ? 400 : 500;
                return reply.code(status).send({ error: status === 400 ? error.message : 'Failed to save row overrides' });
            }
        },
    );

    fastify.post<{ Params: { channel: string; wooId: string }; Body: { fields: string[]; variationWooId?: number } }>(
        '/:channel/rows/:wooId/optimize',
        async (request, reply) => {
            try {
                const accountId = request.accountId!;
                const { channel, wooId } = rowParamsSchema.parse(request.params);
                const { fields, variationWooId } = optimizeRowSchema.parse(request.body);
                const parsedChannel = FeedMappingService.parseChannel(channel);
                const suggestions = await FeedMappingService.optimizeRowFields(
                    accountId,
                    parsedChannel,
                    wooId,
                    fields,
                    variationWooId,
                );
                return { success: true, suggestions };
            } catch (error: any) {
                Logger.error('Failed to optimize feed row fields', { error: error?.message || error });
                if (error?.message === 'Product not found') return reply.code(404).send({ error: 'Product not found' });
                if (error?.message === 'Variation not found') return reply.code(404).send({ error: 'Variation not found' });
                if (error?.message === 'No OpenRouter API key configured') {
                    return reply.code(400).send({ error: 'No OpenRouter API key configured' });
                }
                const status = error?.message === 'Unsupported feed channel' ? 400 : 502;
                return reply.code(status).send({ error: status === 400 ? error.message : 'Failed to optimize fields' });
            }
        },
    );

    fastify.post<{ Params: { channel: string }; Body: { fields: string[]; rows: Array<{ wooId: number; variationWooId?: number }> } }>(
        '/:channel/rows/optimize-bulk',
        async (request, reply) => {
            try {
                const accountId = request.accountId!;
                const { channel } = paramsSchema.parse(request.params);
                const { fields, rows } = optimizeBulkSchema.parse(request.body);
                const parsedChannel = FeedMappingService.parseChannel(channel);
                const maxBulkOptimizeRows = await FeedMappingService.getMaxBulkOptimizeRows(accountId);
                if (rows.length > maxBulkOptimizeRows) {
                    return reply.code(400).send({
                        error: `Selection exceeds bulk optimize cap (${maxBulkOptimizeRows} rows).`,
                        code: 'BULK_OPTIMIZE_LIMIT_EXCEEDED',
                        maxBulkOptimizeRows,
                    });
                }

                const queue = QueueFactory.getQueue(QUEUES.FEED_OPTIMIZE);
                const jobId = `feed_optimize:${accountId}:${parsedChannel}:${Date.now()}`;
                await queue.add(
                    'feed-optimize-bulk',
                    { accountId, channel: parsedChannel, fields, rows },
                    { jobId },
                );

                return reply.code(202).send({
                    success: true,
                    queued: true,
                    queue: QUEUES.FEED_OPTIMIZE,
                    jobId,
                });
            } catch (error: any) {
                Logger.error('Failed to bulk optimize feed rows', { error: error?.message || error });
                if (error?.message === 'No OpenRouter API key configured') {
                    return reply.code(400).send({ error: 'No OpenRouter API key configured' });
                }
                const status = error?.message === 'Unsupported feed channel' ? 400 : 502;
                return reply.code(status).send({ error: status === 400 ? error.message : 'Failed to bulk optimize rows' });
            }
        },
    );

    fastify.get('/settings/bulk-limit', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const maxBulkOptimizeRows = await FeedMappingService.getMaxBulkOptimizeRows(accountId);
            return { maxBulkOptimizeRows };
        } catch (error: any) {
            Logger.error('Failed to fetch feed bulk optimize limit', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch bulk optimize limit' });
        }
    });

    fastify.get('/settings/product-type-category-priority', async (request, reply) => {
        try {
            const productTypeCategoryPriority = await FeedMappingService.getProductTypeCategoryPriority(request.accountId!);
            return { productTypeCategoryPriority };
        } catch (error: any) {
            Logger.error('Failed to fetch product type category priority', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch product type category priority' });
        }
    });

    fastify.get('/settings/urls', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const forwardedProto = request.headers['x-forwarded-proto'];
            const forwardedHost = request.headers['x-forwarded-host'];
            const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : (forwardedProto || request.protocol);
            const host = Array.isArray(forwardedHost) ? forwardedHost[0] : (forwardedHost || request.headers.host || 'localhost:3000');
            const baseUrl = `${proto}://${host}`;
            const urls = await FeedMappingService.getFeedExportUrls(accountId, baseUrl);
            return { urls };
        } catch (error: any) {
            Logger.error('Failed to fetch feed export urls', { error: error?.message || error });
            return reply.code(500).send({ error: 'Failed to fetch feed export URLs' });
        }
    });

    fastify.put<{ Body: { maxBulkOptimizeRows: number } }>('/settings/bulk-limit', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { maxBulkOptimizeRows } = bulkLimitBodySchema.parse(request.body);
            const saved = await FeedMappingService.setMaxBulkOptimizeRows(accountId, maxBulkOptimizeRows);
            return { maxBulkOptimizeRows: saved };
        } catch (error: any) {
            Logger.error('Failed to save feed bulk optimize limit', { error: error?.message || error });
            return reply.code(400).send({ error: 'Failed to save bulk optimize limit' });
        }
    });

    fastify.put<{ Body: { productTypeCategoryPriority: string[] } }>('/settings/product-type-category-priority', async (request, reply) => {
        try {
            const { productTypeCategoryPriority } = productTypeCategoryPriorityBodySchema.parse(request.body);
            const saved = await FeedMappingService.setProductTypeCategoryPriority(request.accountId!, productTypeCategoryPriority);
            return { productTypeCategoryPriority: saved };
        } catch (error: any) {
            Logger.error('Failed to save product type category priority', { error: error?.message || error });
            return reply.code(400).send({ error: 'Failed to save product type category priority' });
        }
    });

    fastify.get<{ Params: { channel: string; jobId: string } }>('/:channel/rows/optimize-bulk/:jobId', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { channel, jobId } = z.object({ channel: z.string().min(1), jobId: z.string().min(1) }).parse(request.params);
            const parsedChannel = FeedMappingService.parseChannel(channel);
            const prefix = `feed_optimize:${accountId}:${parsedChannel}:`;
            if (!jobId.startsWith(prefix)) {
                return reply.code(403).send({ error: 'Invalid job for account/channel' });
            }

            const queue = QueueFactory.getQueue(QUEUES.FEED_OPTIMIZE);
            const job = await queue.getJob(jobId);
            if (!job) return reply.code(404).send({ error: 'Job not found' });

            const state = await job.getState();
            const progress = job.progress || 0;
            const result = state === 'completed' ? job.returnvalue : undefined;
            const failedReason = state === 'failed' ? job.failedReason : undefined;

            return {
                jobId,
                queue: QUEUES.FEED_OPTIMIZE,
                state,
                progress,
                result,
                failedReason,
            };
        } catch (error: any) {
            Logger.error('Failed to fetch bulk optimize job status', { error: error?.message || error });
            const status = error?.message === 'Unsupported feed channel' ? 400 : 500;
            return reply.code(status).send({ error: status === 400 ? error.message : 'Failed to fetch job status' });
        }
    });
};

export default feedsRoutes;
