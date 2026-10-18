import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { NativeAudienceError, NativeAudienceService } from '../services/ads/NativeAudienceService';
import { parseLookalikeDefinition, parseWebsiteDefinition } from '../services/ads/nativeAudienceRules';

/** Child of the authenticated, account-scoped segments plugin. */
export const nativeAudienceRoutes: FastifyPluginAsync = async fastify => {
    fastify.get('/native-audiences', async request => prisma.nativeAdAudience.findMany({
        where: { accountId: request.accountId! }, orderBy: { createdAt: 'desc' }, take: 200,
        include: { adAccount: { select: { name: true, platform: true } } }
    }));

    fastify.get<{ Params: { adAccountId: string } }>('/native-audiences/sources/:adAccountId', async (request, reply) => {
        try {
            return await NativeAudienceService.sources(request.accountId!, request.params.adAccountId);
        } catch (error) {
            return reply.code(error instanceof NativeAudienceError ? error.statusCode : 502).send({ error: error instanceof NativeAudienceError ? error.message : 'Could not load audience sources' });
        }
    });

    fastify.post('/native-audiences', async (request, reply) => {
        const body = request.body as any;
        if (!body || typeof body.adAccountId !== 'string' || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200 || !['WEBSITE', 'LOOKALIKE'].includes(body.kind) || body.consentConfirmed !== true) {
            return reply.code(400).send({ error: 'Provide a name, destination, audience type and advertising consent confirmation' });
        }
        const accountId = request.accountId!;
        try {
            const destination = await NativeAudienceService.destination(accountId, body.adAccountId);
            let definition;
            try {
                definition = body.kind === 'LOOKALIKE' ? parseLookalikeDefinition(body.definition) : parseWebsiteDefinition(destination.platform, body.definition);
            } catch (error) {
                return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid audience rules' });
            }
            const audience = await NativeAudienceService.create(accountId, destination.id, body.kind, body.name.trim(), definition);
            return reply.code(202).send({ id: audience.id, status: audience.status });
        } catch (error) {
            return reply.code(error instanceof NativeAudienceError ? error.statusCode : 503).send({ error: error instanceof NativeAudienceError ? error.message : 'Could not queue audience creation. Refresh the list before retrying.' });
        }
    });

    fastify.post<{ Params: { id: string }; Body: { consentConfirmed?: boolean } }>('/native-audiences/:id/retry', async (request, reply) => {
        const accountId = request.accountId!;
        if (request.body?.consentConfirmed !== true) return reply.code(400).send({ error: 'Confirm advertising consent before retrying' });
        const audience = await prisma.nativeAdAudience.findFirst({ where: { id: request.params.id, accountId } });
        if (!audience) return reply.code(404).send({ error: 'Audience not found' });
        if (audience.status !== 'FAILED' || audience.externalId) return reply.code(409).send({ error: 'Only definitively failed creations can be retried. Check uncertain outcomes in the platform first.' });
        const updated = await prisma.nativeAdAudience.updateMany({
            where: { id: audience.id, accountId, status: 'FAILED', externalId: null },
            data: { status: 'PENDING', lastError: null, consentConfirmedAt: new Date() }
        });
        if (updated.count) await NativeAudienceService.enqueue(accountId, audience.id);
        return reply.code(202).send({ id: audience.id });
    });

    fastify.post<{ Params: { id: string } }>('/native-audiences/:id/reconcile', async (request, reply) => {
        try {
            return await NativeAudienceService.reconcile(request.accountId!, request.params.id);
        } catch (error) {
            return reply.code(error instanceof NativeAudienceError ? error.statusCode : 502).send({ error: error instanceof NativeAudienceError ? error.message : 'Could not check platform creation' });
        }
    });
};
