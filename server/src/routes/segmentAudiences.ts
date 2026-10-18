import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { AudienceSyncService, audienceEmailHashes } from '../services/ads/AudienceSyncService';
import { segmentService } from '../services/SegmentService';

/** Registered inside the authenticated /segments plugin. Never return platform credentials or hashes. */
export const segmentAudienceRoutes: FastifyPluginAsync = async fastify => {
    fastify.get('/destinations', async request => prisma.adAccount.findMany({
        where: { accountId: request.accountId!, platform: { in: ['META', 'GOOGLE'] } },
        select: { id: true, name: true, platform: true, externalId: true }
    }));

    fastify.post<{ Params: { id: string }; Body: { adAccountId?: string; consentConfirmed?: boolean; includeSubscribers?: boolean; enhancedMatching?: boolean } }>('/:id/audiences', async (request, reply) => {
        const accountId = request.accountId!;
        if (!request.body || typeof request.body.adAccountId !== 'string' || request.body.consentConfirmed !== true) {
            return reply.code(400).send({ error: 'Select a destination and confirm advertising consent for all segment members' });
        }
        if (['includeSubscribers', 'enhancedMatching'].some(key => (request.body as any)[key] !== undefined && typeof (request.body as any)[key] !== 'boolean')) {
            return reply.code(400).send({ error: 'Audience options must be booleans' });
        }
        const options = { includeSubscribers: request.body.includeSubscribers === true, enhancedMatching: request.body.enhancedMatching === true };
        const [segment, destination] = await Promise.all([
            segmentService.getSegment(request.params.id, accountId),
            prisma.adAccount.findFirst({ where: { id: request.body.adAccountId, accountId, platform: { in: ['META', 'GOOGLE'] } } })
        ]);
        if (!segment || !destination) return reply.code(404).send({ error: 'Segment or destination not found' });
        const sync = await prisma.audienceSync.upsert({
            where: { accountId_segmentId_platform_adAccountId: { accountId, segmentId: segment.id, platform: destination.platform, adAccountId: destination.id } },
            create: { accountId, segmentId: segment.id, adAccountId: destination.id, platform: destination.platform, audienceName: `Overseek - ${segment.name}`.slice(0, 200), autoSyncEnabled: true, consentConfirmedAt: new Date(), ...options },
            update: { autoSyncEnabled: true, consentConfirmedAt: new Date(), status: 'PENDING', lastError: null, ...options }
        });
        await AudienceSyncService.enqueue(accountId, sync.id);
        return reply.code(202).send({ id: sync.id });
    });

    fastify.patch<{ Params: { id: string; syncId: string }; Body: { enabled?: boolean } }>('/:id/audiences/:syncId', async (request, reply) => {
        const accountId = request.accountId!;
        if (typeof request.body?.enabled !== 'boolean') return reply.code(400).send({ error: 'enabled must be a boolean' });
        const sync = await prisma.audienceSync.findFirst({ where: { id: request.params.syncId, segmentId: request.params.id, accountId, isLookalike: false } });
        if (!sync) return reply.code(404).send({ error: 'Audience not found' });
        if (request.body.enabled && !sync.consentConfirmedAt) return reply.code(400).send({ error: 'Set up this audience with advertising consent first' });
        await prisma.audienceSync.update({ where: { id: sync.id }, data: { autoSyncEnabled: request.body.enabled, status: request.body.enabled ? 'PENDING' : 'PAUSED' } });
        if (request.body.enabled) await AudienceSyncService.enqueue(accountId, sync.id);
        return { success: true };
    });

    fastify.get<{ Params: { id: string }; Querystring: { platform?: string } }>('/:id/ad-export', async (request, reply) => {
        const accountId = request.accountId!;
        const platform = request.query.platform;
        if (platform !== 'META' && platform !== 'GOOGLE') return reply.code(400).send({ error: 'Choose META or GOOGLE' });
        const segment = await segmentService.getSegment(request.params.id, accountId);
        if (!segment) return reply.code(404).send({ error: 'Segment not found' });
        const customers = await segmentService.getExportableCustomers(accountId, segment.id, true);
        const hashes = audienceEmailHashes(customers.emails, platform);
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Cache-Control', 'no-store');
        reply.header('Content-Disposition', `attachment; filename="audience-${platform.toLowerCase()}.csv"`);
        return [platform === 'META' ? 'email' : 'Email', ...hashes].join('\r\n');
    });
};
