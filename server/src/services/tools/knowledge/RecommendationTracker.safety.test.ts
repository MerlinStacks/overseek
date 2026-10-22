import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ allowed: true, update: vi.fn(), find: vi.fn(), many: vi.fn(), create: vi.fn() }));
vi.mock('../../../utils/prisma', () => ({ prisma: { recommendationLog: { updateMany: m.update, findFirst: m.find, findMany: m.many, createMany: m.create }, adAccount: { findFirst: async () => ({ id: 'ad' }) } } }));
vi.mock('../../PermissionService', () => ({ PermissionService: { hasPermission: async () => m.allowed } }));
import { RecommendationTracker } from './RecommendationTracker';
const version = '2026-10-20T00:00:00.000Z';
beforeEach(() => { vi.clearAllMocks(); m.allowed = true; m.update.mockResolvedValue({ count: 1 }); m.many.mockResolvedValue([]); });
it('requires actor permission and uses account/version/lifecycle conditional writes', async () => {
    await RecommendationTracker.recordFeedback('a', 'u', 'log', { status: 'dismissed', version }); expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'log', accountId: 'a', status: 'pending', updatedAt: new Date(version) } }));
    m.allowed = false; await expect(RecommendationTracker.recordFeedback('a', 'u', 'foreign', { status: 'implemented', version })).rejects.toMatchObject({ statusCode: 403 }); expect(m.update).toHaveBeenCalledOnce();
});
it('returns conflicts for missing/foreign/stale rows rather than claiming success', async () => { m.update.mockResolvedValue({ count: 0 }); await expect(RecommendationTracker.recordFeedback('a', 'u', 'foreign', { status: 'implemented', version })).rejects.toMatchObject({ statusCode: 409 }); });
it('requires matching resource provenance and records observations without causal success', async () => {
    const outcome = { version, roasBefore: 1, roasAfter: 2, adAccountId: 'ad', resourceId: 'campaign', currency: 'AUD', before: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-08T00:00:00.000Z' }, after: { start: '2026-10-08T00:00:00.000Z', end: '2026-10-15T00:00:00.000Z' } };
    m.find.mockResolvedValue({ campaignId: 'campaign', resourceAccountId: 'ad', implementedAt: new Date(outcome.before.end) }); await RecommendationTracker.recordOutcome('a', 'u', 'log', outcome);
    expect(m.update.mock.calls[0][0].data).toMatchObject({ wasSuccessful: null, roasChange: 100, outcomeObservation: { basis: 'user-reported-observation-not-causal-success', reporterUserId: 'u' } });
    m.find.mockResolvedValue(null); await expect(RecommendationTracker.recordOutcome('a', 'u', 'foreign', outcome)).rejects.toMatchObject({ statusCode: 409 });
});
it('preserves exact rule IDs and stable generation occurrence identities', async () => {
    const rec = { id: 'google_pmax_learning_campaign_1', text: 'Review data', category: 'optimization', priority: 3 as const, explanation: 'Observe', dataPoints: [], tags: [], confidence: { score: 50, level: 'low' as const, factors: [] }, source: 'rule' as const };
    await RecommendationTracker.logRecommendations('a', [rec], 'run-1'); await RecommendationTracker.logRecommendations('a', [rec], 'run-1');
    expect(m.create.mock.calls[0][0].data[0].recommendationId).toBe(rec.id); expect(m.create.mock.calls[0][0].data[0].id).toBe(m.create.mock.calls[1][0].data[0].id);
});
it('rejects invalid history bounds and never learns causal success from legacy associations', async () => {
    await expect(RecommendationTracker.getHistory('a', { limit: 10000 })).rejects.toThrow(); await expect(RecommendationTracker.getStats('a', NaN)).rejects.toThrow(); expect((await RecommendationTracker.getStats('a')).successRate).toBeNull(); expect(await RecommendationTracker.getSuccessRateForRule('exact_rule', 'a')).toBeNull();
});
