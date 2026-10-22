import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { shippingService } from '../services/shipping/ShippingService';
const identity = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const credentials = z.object({ stationId: identity, token: z.string().min(16).max(512), agentVersion: z.string().max(20).regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/) });
function auth(request: FastifyRequest) { return credentials.parse({ stationId: request.headers['x-print-station-id'], token: request.headers['x-print-station-token'], agentVersion: request.headers['x-print-agent-version'] }); }
function failed(error: unknown, reply: FastifyReply) {
    const code = (error as { statusCode?: number }).statusCode;
    const status = error instanceof z.ZodError ? 400 : (error as Error).message === 'Invalid print station credentials' ? 401 : [404, 409, 426].includes(code ?? 0) ? code! : 503;
    return reply.code(status).send({ error: status === 426 ? 'Attempt-aware print agent protocol/version upgrade required' : status === 401 ? 'Invalid print station credentials' : status === 400 ? 'Bounded station credentials, version and attempt identity required' : status === 404 ? 'Print job not found' : 'Print outcome unavailable; reconcile the original attempt before printing again' });
}
const shippingPrintAgentRoutes: FastifyPluginAsync = async fastify => {
    fastify.get('/jobs', async (request, reply) => { try { const c = auth(request); return await shippingService.listPendingPrintJobsForStation(c.stationId, c.token, c.agentVersion); } catch (error) { return failed(error, reply); } });
    fastify.post('/jobs/:id/result', async (request, reply) => { try { const c = auth(request), params = z.object({ id: identity }).strict().parse(request.params), body = z.object({ claimId: z.string().uuid(), status: z.enum(['printed', 'failed']), errorMessage: z.string().max(2000).optional() }).strict().parse(request.body); return { printJob: await shippingService.reportPrintJobResult(c.stationId, c.token, params.id, body.status, body.errorMessage, body.claimId, c.agentVersion) }; } catch (error) { return failed(error, reply); } });
    fastify.get('/jobs/:id/label', async (request, reply) => { try { const c = auth(request), params = z.object({ id: identity }).strict().parse(request.params), query = z.object({ claimId: z.string().uuid() }).strict().parse(request.query); const label = await shippingService.getPrintJobLabelPdfForStation(c.stationId, c.token, params.id, query.claimId, c.agentVersion); return reply.header('Cache-Control', 'no-store').header('Content-Type', label.contentType).header('Content-Disposition', `attachment; filename="${label.fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`).send(label.pdf); } catch (error) { return failed(error, reply); } });
};
export default shippingPrintAgentRoutes;
