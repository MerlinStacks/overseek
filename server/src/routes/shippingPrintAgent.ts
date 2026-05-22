import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Logger } from '../utils/logger';
import { shippingService } from '../services/shipping/ShippingService';

const jobResultSchema = z.object({
    status: z.enum(['printed', 'failed']),
    errorMessage: z.string().max(2000).optional(),
});

const jobParamsSchema = z.object({
    id: z.string().min(1),
});

function getStationCredentials(request: any) {
    return {
        stationId: String(request.headers['x-print-station-id'] || ''),
        token: String(request.headers['x-print-station-token'] || ''),
        agentVersion: request.headers['x-print-agent-version'] ? String(request.headers['x-print-agent-version']) : undefined,
    };
}

const shippingPrintAgentRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get('/jobs', async (request, reply) => {
        try {
            const { stationId, token, agentVersion } = getStationCredentials(request);
            if (!stationId || !token) return reply.code(401).send({ error: 'Print station credentials required' });
            return await shippingService.listPendingPrintJobsForStation(stationId, token, agentVersion);
        } catch (error: any) {
            Logger.error('[ShippingPrintAgentRoutes] Failed to fetch print jobs', { error: error?.message || error });
            const status = error?.message === 'Invalid print station credentials'
                ? 401
                : String(error?.message || '').includes('minimum version')
                    ? 426
                    : 500;
            return reply.code(status).send({ error: status === 401 ? 'Invalid print station credentials' : error?.message || 'Failed to fetch print jobs' });
        }
    });

    fastify.post<{ Params: { id: string } }>('/jobs/:id/result', async (request, reply) => {
        try {
            const { stationId, token } = getStationCredentials(request);
            if (!stationId || !token) return reply.code(401).send({ error: 'Print station credentials required' });
            const params = jobParamsSchema.safeParse(request.params);
            const parsed = jobResultSchema.safeParse(request.body);
            if (!params.success) return reply.code(400).send({ error: 'Invalid print job id' });
            if (!parsed.success) return reply.code(400).send({ error: 'Invalid print result payload', details: parsed.error.flatten() });
            return { printJob: await shippingService.reportPrintJobResult(stationId, token, params.data.id, parsed.data.status, parsed.data.errorMessage) };
        } catch (error: any) {
            Logger.error('[ShippingPrintAgentRoutes] Failed to report print job result', { error: error?.message || error });
            const status = error?.message === 'Invalid print station credentials'
                ? 401
                : error?.message === 'Print job not found'
                    ? 404
                    : error?.message === 'Print job is not in a reportable state'
                        ? 409
                        : 500;
            return reply.code(status).send({
                error: status === 401
                    ? 'Invalid print station credentials'
                    : status === 404
                        ? 'Print job not found'
                        : status === 409
                            ? 'Print job is not in a reportable state'
                            : 'Failed to report print job result',
            });
        }
    });

    fastify.get<{ Params: { id: string } }>('/jobs/:id/label', async (request, reply) => {
        try {
            const { stationId, token } = getStationCredentials(request);
            if (!stationId || !token) return reply.code(401).send({ error: 'Print station credentials required' });
            const params = jobParamsSchema.safeParse(request.params);
            if (!params.success) return reply.code(400).send({ error: 'Invalid print job id' });
            const label = await shippingService.getPrintJobLabelPdfForStation(stationId, token, params.data.id);
            reply.header('Content-Type', label.contentType);
            reply.header('Content-Disposition', `attachment; filename="${label.fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`);
            return reply.send(label.pdf);
        } catch (error: any) {
            Logger.error('[ShippingPrintAgentRoutes] Failed to download label PDF', { error: error?.message || error });
            const status = error?.message === 'Invalid print station credentials'
                ? 401
                : error?.message === 'Print job not found'
                    ? 404
                    : ['Print job is not in a downloadable state', 'Stored label PDF path is invalid or unavailable'].includes(error?.message)
                        ? 409
                        : 500;
            return reply.code(status).send({ error: error?.message || 'Failed to download label PDF' });
        }
    });
};

export default shippingPrintAgentRoutes;
