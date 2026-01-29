/**
 * Creative Experiment Routes
 * 
 * API endpoints for A/B testing of ad creatives.
 * Part of AI Co-Pilot v2 - Phase 4: Creative A/B Engine.
 */

import { FastifyInstance } from 'fastify';
import { CreativeVariantService, CreateExperimentParams, VariantContent } from '../../services/ads/CreativeVariantService';
import { AdCopyGenerator } from '../../services/tools/AdCopyGenerator';
import { requireAuthFastify } from '../../middleware/auth';
import { prisma } from '../../utils/prisma';

interface CreateExperimentBody {
    name: string;
    platform: 'google' | 'meta';
    adAccountId: string;
    campaignId?: string;
    adGroupId?: string;
    primaryMetric?: 'ctr' | 'conversions' | 'roas';
    minSampleSize?: number;
}

interface AddVariantBody {
    headlines?: string[];
    descriptions?: string[];
    primaryTexts?: string[];
    isControl?: boolean;
}

interface GenerateVariantsBody {
    baseHeadlines: string[];
    baseDescriptions: string[];
    variantCount: number;
    platform?: 'google' | 'meta';
}

interface ConcludeBody {
    winnerId?: string;
}

export default async function experimentsRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * GET /api/ads/experiments
     * List all experiments for the account.
     */
    fastify.get<{ Querystring: { status?: string } }>('/', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { status } = request.query;
        const experiments = await CreativeVariantService.listExperiments(accountId, status);

        return { experiments };
    });

    /**
     * POST /api/ads/experiments
     * Create a new A/B experiment.
     */
    fastify.post<{ Body: CreateExperimentBody }>('/', {
        schema: {
            body: {
                type: 'object',
                required: ['name', 'platform', 'adAccountId'],
                properties: {
                    name: { type: 'string', minLength: 1 },
                    platform: { type: 'string', enum: ['google', 'meta'] },
                    adAccountId: { type: 'string' },
                    campaignId: { type: 'string' },
                    adGroupId: { type: 'string' },
                    primaryMetric: { type: 'string', enum: ['ctr', 'conversions', 'roas'] },
                    minSampleSize: { type: 'number', minimum: 50 }
                }
            }
        }
    }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const experiment = await CreativeVariantService.createExperiment(
            accountId,
            request.body as CreateExperimentParams
        );

        return { success: true, experiment };
    });

    /**
     * GET /api/ads/experiments/:id
     * Get experiment details with variants.
     */
    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { id } = request.params;
        const experiment = await CreativeVariantService.getExperiment(id);

        if (!experiment || experiment.accountId !== accountId) {
            return reply.code(404).send({ error: 'Experiment not found' });
        }

        return { experiment };
    });

    /**
     * POST /api/ads/experiments/:id/variants
     * Add a variant to an experiment.
     */
    fastify.post<{ Params: { id: string }; Body: AddVariantBody }>('/:id/variants', {
        schema: {
            body: {
                type: 'object',
                properties: {
                    headlines: { type: 'array', items: { type: 'string' } },
                    descriptions: { type: 'array', items: { type: 'string' } },
                    primaryTexts: { type: 'array', items: { type: 'string' } },
                    isControl: { type: 'boolean' }
                }
            }
        }
    }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { id } = request.params;

        // Verify experiment belongs to account
        const experiment = await CreativeVariantService.getExperiment(id);
        if (!experiment || experiment.accountId !== accountId) {
            return reply.code(404).send({ error: 'Experiment not found' });
        }

        const variant = await CreativeVariantService.addVariant(id, request.body as VariantContent);

        return { success: true, variant };
    });

    /**
     * POST /api/ads/experiments/:id/generate-variants
     * Generate AI-powered variants for an experiment.
     */
    fastify.post<{ Params: { id: string }; Body: GenerateVariantsBody }>('/:id/generate-variants', {
        schema: {
            body: {
                type: 'object',
                required: ['baseHeadlines', 'baseDescriptions', 'variantCount'],
                properties: {
                    baseHeadlines: { type: 'array', items: { type: 'string' } },
                    baseDescriptions: { type: 'array', items: { type: 'string' } },
                    variantCount: { type: 'number', minimum: 2, maximum: 5 },
                    platform: { type: 'string', enum: ['google', 'meta'] }
                }
            }
        }
    }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { id } = request.params;
        const { baseHeadlines, baseDescriptions, variantCount, platform } = request.body;

        // Verify experiment belongs to account
        const experiment = await CreativeVariantService.getExperiment(id);
        if (!experiment || experiment.accountId !== accountId) {
            return reply.code(404).send({ error: 'Experiment not found' });
        }

        // Generate variants using AI
        const baseCopy = {
            headlines: baseHeadlines,
            descriptions: baseDescriptions,
            source: 'ai' as const
        };

        const variants = await AdCopyGenerator.generateVariants(
            accountId,
            baseCopy,
            variantCount,
            (platform || experiment.platform) as 'google' | 'meta'
        );

        // Add each variant to the experiment
        const addedVariants = [];
        for (let i = 0; i < variants.length; i++) {
            const variant = await CreativeVariantService.addVariant(id, {
                headlines: variants[i].headlines,
                descriptions: variants[i].descriptions,
                primaryTexts: variants[i].primaryTexts,
                isControl: i === 0
            });
            addedVariants.push(variant);
        }

        return { success: true, variants: addedVariants };
    });

    /**
     * POST /api/ads/experiments/:id/refresh
     * Refresh metrics for an experiment.
     */
    fastify.post<{ Params: { id: string } }>('/:id/refresh', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { id } = request.params;

        // Verify experiment belongs to account
        const experiment = await CreativeVariantService.getExperiment(id);
        if (!experiment || experiment.accountId !== accountId) {
            return reply.code(404).send({ error: 'Experiment not found' });
        }

        await CreativeVariantService.refreshExperimentMetrics(id);

        // Return updated experiment
        const updated = await CreativeVariantService.getExperiment(id);

        return { success: true, experiment: updated };
    });

    /**
     * POST /api/ads/experiments/:id/analyze
     * Analyze statistical significance.
     */
    fastify.post<{ Params: { id: string } }>('/:id/analyze', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { id } = request.params;

        // Verify experiment belongs to account
        const experiment = await CreativeVariantService.getExperiment(id);
        if (!experiment || experiment.accountId !== accountId) {
            return reply.code(404).send({ error: 'Experiment not found' });
        }

        const analysis = await CreativeVariantService.analyzeSignificance(id);

        return { success: true, analysis };
    });

    /**
     * POST /api/ads/experiments/:id/conclude
     * End experiment and declare winner.
     */
    fastify.post<{ Params: { id: string }; Body: ConcludeBody }>('/:id/conclude', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { id } = request.params;
        const { winnerId } = request.body;

        // Verify experiment belongs to account
        const experiment = await CreativeVariantService.getExperiment(id);
        if (!experiment || experiment.accountId !== accountId) {
            return reply.code(404).send({ error: 'Experiment not found' });
        }

        await CreativeVariantService.concludeExperiment(id, winnerId);

        return { success: true, message: 'Experiment concluded' };
    });

    /**
     * POST /api/ads/experiments/:id/pause
     * Pause an experiment.
     */
    fastify.post<{ Params: { id: string } }>('/:id/pause', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { id } = request.params;

        // Verify experiment belongs to account
        const experiment = await CreativeVariantService.getExperiment(id);
        if (!experiment || experiment.accountId !== accountId) {
            return reply.code(404).send({ error: 'Experiment not found' });
        }

        await CreativeVariantService.pauseExperiment(id);

        return { success: true, message: 'Experiment paused' };
    });

    /**
     * POST /api/ads/experiments/:id/resume
     * Resume a paused experiment.
     */
    fastify.post<{ Params: { id: string } }>('/:id/resume', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { id } = request.params;

        // Verify experiment belongs to account
        const experiment = await CreativeVariantService.getExperiment(id);
        if (!experiment || experiment.accountId !== accountId) {
            return reply.code(404).send({ error: 'Experiment not found' });
        }

        await CreativeVariantService.resumeExperiment(id);

        return { success: true, message: 'Experiment resumed' };
    });
}
