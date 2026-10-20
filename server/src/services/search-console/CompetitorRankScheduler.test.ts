import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ configured: vi.fn(), accounts: vi.fn(), sync: vi.fn(), refresh: vi.fn() }));
vi.mock('./SerpCheckService', () => ({ SerpCheckService: { isConfigured: mocks.configured } }));
vi.mock('./CompetitorAnalysisService', () => ({ CompetitorAnalysisService: { syncCompetitorKeywords: mocks.sync, refreshCompetitorPositions: mocks.refresh } }));
vi.mock('../../utils/prisma', () => ({ prisma: { competitorDomain: { findMany: mocks.accounts } } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn() } }));
import { startCompetitorRankScheduler, stopCompetitorRankScheduler } from './CompetitorRankScheduler';
const INITIAL = 125 * 60000;
beforeEach(async () => { await stopCompetitorRankScheduler(); vi.resetAllMocks(); vi.useFakeTimers(); mocks.configured.mockResolvedValue(true); mocks.accounts.mockResolvedValue([{ accountId: 'a' }]); mocks.refresh.mockResolvedValue({ checked: 1, movements: [] }); });
afterEach(async () => { await stopCompetitorRankScheduler(); vi.useRealTimers(); });
describe('competitor scheduler lifecycle', () => {
    it('schedules once and honors the initial delay', async () => {
        startCompetitorRankScheduler(); startCompetitorRankScheduler(); expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(INITIAL - 1); expect(mocks.refresh).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1); expect(mocks.refresh).toHaveBeenCalledOnce();
    });
    it('drains a running refresh without resurrecting the scheduler', async () => {
        let resolve!: () => void; mocks.sync.mockReturnValue(new Promise<void>(r => { resolve = r; }));
        startCompetitorRankScheduler(); await vi.advanceTimersByTimeAsync(INITIAL);
        let stopped = false; const stop = stopCompetitorRankScheduler().then(() => { stopped = true; });
        expect(stopped).toBe(false); resolve(); await stop; await vi.advanceTimersByTimeAsync(86400000);
        expect(mocks.refresh).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    });
    it('does not overlap generations on restart', async () => {
        let resolve!: () => void; mocks.sync.mockReturnValueOnce(new Promise<void>(r => { resolve = r; }));
        startCompetitorRankScheduler(); await vi.advanceTimersByTimeAsync(INITIAL);
        const stop = stopCompetitorRankScheduler(); startCompetitorRankScheduler(); await vi.advanceTimersByTimeAsync(INITIAL + 86400000);
        expect(mocks.sync).toHaveBeenCalledOnce(); resolve(); await stop; await vi.advanceTimersByTimeAsync(0);
        expect(mocks.sync).toHaveBeenCalledTimes(2);
    });
    it('handles configuration errors and continues the daily schedule', async () => {
        mocks.configured.mockRejectedValueOnce(new Error('Database unavailable')); startCompetitorRankScheduler();
        await vi.advanceTimersByTimeAsync(INITIAL); await vi.advanceTimersByTimeAsync(86400000); expect(mocks.refresh).toHaveBeenCalledOnce();
    });
});
