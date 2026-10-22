import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ list: vi.fn(), report: vi.fn(), pdf: vi.fn() }));
vi.mock('../services/shipping/ShippingService', () => ({ shippingService: { listPendingPrintJobsForStation: m.list, reportPrintJobResult: m.report, getPrintJobLabelPdfForStation: m.pdf } }));
import routes from './shippingPrintAgent';
const headers = { 'x-print-station-id': 'station', 'x-print-station-token': 'test-credential-long-enough', 'x-print-agent-version': '2.0.0' }, claimId = 'a9ab0598-49b4-48cd-9649-60421e77aad4';
beforeEach(() => vi.resetAllMocks());
describe('bounded print API', () => {
    it('refuses missing versions and attemptless results without invoking service', async () => { const app = Fastify(); await app.register(routes); expect((await app.inject({ url: '/jobs', headers: { ...headers, 'x-print-agent-version': '' } })).statusCode).toBe(400); expect((await app.inject({ method: 'POST', url: '/jobs/job/result', headers, payload: { status: 'printed' } })).statusCode).toBe(400); expect(m.report).not.toHaveBeenCalled(); await app.close(); });
    it('passes claim and explicit version to result admission', async () => { const app = Fastify(); await app.register(routes); m.report.mockResolvedValue({ id: 'job' }); expect((await app.inject({ method: 'POST', url: '/jobs/job/result', headers, payload: { claimId, status: 'printed' } })).statusCode).toBe(200); expect(m.report).toHaveBeenCalledWith('station', headers['x-print-station-token'], 'job', 'printed', undefined, claimId, '2.0.0'); await app.close(); });
    it('does not disclose provider or filesystem errors', async () => { const app = Fastify(); await app.register(routes); m.list.mockRejectedValue(new Error('/secret/path provider-token')); const result = await app.inject({ url: '/jobs', headers }); expect(result.statusCode).toBe(503); expect(result.body).not.toContain('/secret'); expect(result.body).not.toContain('provider-token'); await app.close(); });
});
