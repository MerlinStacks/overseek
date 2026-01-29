/**
 * Audience Sync Routes
 * 
 * API endpoints for managing customer segment synchronization to ad platforms.
 * Part of AI Co-Pilot v2 - Phase 2: Audience Intelligence.
 */

import { FastifyInstance } from 'fastify';
import { AudienceSyncService } from '../../services/ads/AudienceSyncService';
import { requireAuthFastify } from '../../middleware/auth';

/**
 * Request body schemas for validation
 */
interface SyncSegmentBody {
    segmentId: string;
    adAccountId: string;
    platform: 'META' | 'GOOGLE';
    audienceName?: string;
}

interface CreateLookalikeBody {
    percent: 1 | 3 | 5;
    countryCode?: string;
}

interface DeleteParams {
    id: string;
}

interface DeleteQuery {
    deleteFromPlatform?: boolean;
}

export default async function audienceSyncRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * POST /api/ads/audiences/sync
     * Sync a customer segment to an ad platform audience.
     */
    fastify.post<{ Body: SyncSegmentBody }>('/sync', {
        schema: {
            body: {
                type: 'object',
                required: ['segmentId', 'adAccountId', 'platform'],
                properties: {
                    segmentId: { type: 'string' },
                    adAccountId: { type: 'string' },
                    platform: { type: 'string', enum: ['META', 'GOOGLE'] },
                    audienceName: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const { segmentId, adAccountId, platform, audienceName } = request.body;

        const options = { accountId, segmentId, adAccountId, audienceName };

        const result = platform === 'META'
            ? await AudienceSyncService.syncSegmentToMeta(options)
            : await AudienceSyncService.syncSegmentToGoogle(options);

        return result;
    });

    /**
     * GET /api/ads/audiences
     * List all audience syncs for the account.
     */
    fastify.get('/', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account selected' });

        const audiences = await AudienceSyncService.getAudienceSyncs(accountId);
        return { audiences };
    });


    /**
     * GET /api/ads/audiences/:id
     * Get details of a specific audience sync.
     */
    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const { id } = request.params;
        const audience = await AudienceSyncService.getAudienceSync(id);

        if (!audience) {
            return reply.status(404).send({ error: 'Audience sync not found' });
        }

        return audience;
    });

    /**
     * POST /api/ads/audiences/:id/refresh
     * Refresh an audience with updated segment members.
     */
    fastify.post<{ Params: { id: string } }>('/:id/refresh', async (request, reply) => {
        const { id } = request.params;
        const result = await AudienceSyncService.refreshAudience(id);
        return result;
    });

    /**
     * POST /api/ads/audiences/:id/lookalike
     * Create a lookalike audience from a synced audience.
     */
    fastify.post<{ Params: { id: string }; Body: CreateLookalikeBody }>('/:id/lookalike', {
        schema: {
            body: {
                type: 'object',
                required: ['percent'],
                properties: {
                    percent: { type: 'number', enum: [1, 3, 5] },
                    countryCode: { type: 'string', default: 'US' }
                }
            }
        }
    }, async (request, reply) => {
        const { id } = request.params;
        const { percent, countryCode } = request.body;

        const result = await AudienceSyncService.createLookalike({
            audienceSyncId: id,
            percent,
            countryCode
        });

        return result;
    });

    /**
     * DELETE /api/ads/audiences/:id
     * Delete an audience sync (optionally from platform as well).
     */
    fastify.delete<{ Params: DeleteParams; Querystring: DeleteQuery }>('/:id', async (request, reply) => {
        const { id } = request.params;
        const deleteFromPlatform = request.query.deleteFromPlatform === true;

        await AudienceSyncService.deleteAudienceSync(id, deleteFromPlatform);

        return { success: true };
    });
}

// Route prefix for registration
export const audienceSyncRoutePrefix = '/api/ads/audiences';
