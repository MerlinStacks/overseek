import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ correlation: vi.fn(), negative: vi.fn() }));
vi.mock('../../services/ads/SearchToAdsIntelligenceService', () => ({ SearchToAdsIntelligenceService: { getCorrelation: m.correlation } }));
vi.mock('../../services/tools/analyzers/NegativeKeywordAnalyzer', () => ({ NegativeKeywordAnalyzer: { analyze: m.negative } }));
vi.mock('../../services/tools/analyzers/CannibalizationAnalyzer', () => ({ CannibalizationAnalyzer: { analyze: vi.fn() } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('./routeHelpers', () => ({ getAdsAccountIdOrReply: () => 'account-a' }));
import intelligenceRoutes from './intelligence';
let app: ReturnType<typeof Fastify>;
beforeEach(async () => { vi.resetAllMocks(); app = Fastify(); await app.register(intelligenceRoutes); m.negative.mockResolvedValue({ hasData: false, summary: { negativeCandidates: 0, estimatedMonthlySavings: 0 } }); });
afterEach(async () => { await app.close(); });
describe('intelligence summary availability', () => {
    it('keeps organic-only opportunities visible and returns their source currency', async () => {
        m.correlation.mockResolvedValue({ currency: 'EUR', overlap: [], organicOnly: [{ query: 'Opportunity' }], summary: { overlapCount: 0, organicOnlyCount: 1, estimatedTotalWastedSpend: 0, estimatedUntappedValue: 10 } });
        const response = await app.inject({ method: 'GET', url: '/summary' });
        expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ currency: 'EUR', hasData: true, organicOnlyCount: 1 }); expect(m.correlation).toHaveBeenCalledWith('account-a');
    });
    it('does not convert a failed scan into zero metrics', async () => {
        m.correlation.mockRejectedValue(new Error('Unavailable')); const response = await app.inject({ method: 'GET', url: '/summary' });
        expect(response.statusCode).toBe(500); expect(response.json()).not.toHaveProperty('estimatedWastedSpend');
    });
});
