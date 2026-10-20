import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ findMany: vi.fn(), history: vi.fn(), findUnique: vi.fn(), count: vi.fn(), update: vi.fn(), create: vi.fn(), lock: vi.fn(), transaction: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { competitorKeyword: { findMany: m.findMany }, competitorRankHistory: { findMany: m.history }, trackedKeyword: { findUnique: m.findUnique, count: m.count, update: m.update, create: m.create }, $transaction: m.transaction } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('./SearchConsoleService', () => ({ SearchConsoleService: {} }));
vi.mock('./SerpCheckService', () => ({ SerpCheckService: {} }));
vi.mock('../events', () => ({ EventBus: {}, EVENTS: {} }));
import { CompetitorAnalysisService } from './CompetitorAnalysisService';
import { KeywordTrackingService } from './KeywordTrackingService';
beforeEach(() => { vi.resetAllMocks(); m.findMany.mockResolvedValue([]); m.history.mockResolvedValue([]); m.transaction.mockImplementation(work => work({ $queryRaw: m.lock, trackedKeyword: { findUnique: m.findUnique, count: m.count, update: m.update, create: m.create } })); });
describe('rank service isolation and limits', () => {
    it('scopes keywords and history to both tenant and requested competitor', async () => {
        await CompetitorAnalysisService.getCompetitorKeywords('tenant', 'competitor'); expect(m.findMany.mock.calls[0][0].where).toEqual({ competitorId: 'competitor', competitor: { accountId: 'tenant' } });
        await CompetitorAnalysisService.getCompetitorKeywordHistory('tenant', 'competitor', 'keyword'); expect(m.history.mock.calls[0][0].where.competitorKeyword).toEqual({ competitorId: 'competitor', competitor: { accountId: 'tenant' } });
    });
    it('rejects missing tenant context', async () => { await expect(CompetitorAnalysisService.getCompetitorKeywords('', 'id')).rejects.toThrow('Account ID'); });
    it('locks the account before enforcing the cap on reactivation', async () => {
        m.findUnique.mockResolvedValue({ id: 'kw', isActive: false }); m.count.mockResolvedValue(100);
        await expect(KeywordTrackingService.addKeyword('tenant', 'Query')).rejects.toThrow('Maximum'); expect(m.lock).toHaveBeenCalledOnce(); expect(m.update).not.toHaveBeenCalled();
    });
    it('does not reject already-active keywords at the cap', async () => {
        m.findUnique.mockResolvedValue({ id: 'kw', keyword: 'query', isActive: true }); expect((await KeywordTrackingService.addKeyword('tenant', 'Query')).id).toBe('kw'); expect(m.count).not.toHaveBeenCalled();
    });
});
