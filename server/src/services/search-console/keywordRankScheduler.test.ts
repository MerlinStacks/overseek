import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const refresh = vi.hoisted(() => vi.fn());
vi.mock('./KeywordTrackingService', () => ({ KeywordTrackingService: { refreshAllAccounts: refresh } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn() } }));
import { startKeywordRankScheduler, stopKeywordRankScheduler } from './keywordRankScheduler';
beforeEach(async () => { await stopKeywordRankScheduler(); vi.clearAllMocks(); vi.useFakeTimers(); refresh.mockResolvedValue(undefined); });
afterEach(async () => { await stopKeywordRankScheduler(); vi.useRealTimers(); });
describe('keyword rank scheduler lifecycle', () => {
    it('starts only once and waits five minutes before the first refresh', async () => {
        startKeywordRankScheduler(); startKeywordRankScheduler(); expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(300000); expect(refresh).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
    });
    it('does not resurrect after stop while the initial refresh is in flight', async () => {
        let resolve!: () => void; refresh.mockReturnValue(new Promise<void>(r => { resolve = r; }));
        startKeywordRankScheduler(); await vi.advanceTimersByTimeAsync(300000);
        let stopped = false; const stopping = stopKeywordRankScheduler().then(() => { stopped = true; });
        expect(stopped).toBe(false); resolve(); await stopping; await vi.advanceTimersByTimeAsync(86400000);
        expect(refresh).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    });
    it('does not overlap long-running refreshes and can restart after stopping', async () => {
        let resolve!: () => void; refresh.mockReturnValueOnce(new Promise<void>(r => { resolve = r; }));
        startKeywordRankScheduler(); await vi.advanceTimersByTimeAsync(300000); await vi.advanceTimersByTimeAsync(2 * 86400000);
        expect(refresh).toHaveBeenCalledOnce();
        const stopping = stopKeywordRankScheduler(); startKeywordRankScheduler(); await vi.advanceTimersByTimeAsync(300000);
        expect(refresh).toHaveBeenCalledOnce(); resolve(); await stopping; await vi.advanceTimersByTimeAsync(0);
        expect(refresh).toHaveBeenCalledTimes(2);
    });
    it('keeps scheduling after a failed refresh', async () => {
        refresh.mockRejectedValueOnce(new Error('Provider unavailable'));
        startKeywordRankScheduler(); await vi.advanceTimersByTimeAsync(300000); await vi.advanceTimersByTimeAsync(86400000);
        expect(refresh).toHaveBeenCalledTimes(2);
    });
});
