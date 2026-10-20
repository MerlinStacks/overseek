import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ credentials: vi.fn(), fetch: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { platformCredentials: { findUnique: mocks.credentials } } }));
vi.mock('../../utils/logger', () => ({ Logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../utils/retryWithBackoff', () => ({ retryWithBackoff: (work: () => Promise<unknown>) => work() }));
import { SerpCheckService } from './SerpCheckService';
const page = (items: unknown[] = []) => ({ ok: true, json: async () => ({ items }) });
beforeEach(() => { vi.resetAllMocks(); SerpCheckService.clearCache(); vi.stubGlobal('fetch', mocks.fetch); mocks.credentials.mockResolvedValue({ credentials: { apiKey: 'key', searchEngineId: 'engine' } }); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('SERP check reliability', () => {
    it('normalizes domains, checks subdomains, and caches successful results', async () => {
        mocks.fetch.mockResolvedValue(page([{ link: 'https://unrelated.test' }, { link: 'https://shop.example.com/product' }]));
        expect(await SerpCheckService.checkPosition(' Query ', 'https://www.example.com/')).toEqual({ position: 2, rankingUrl: 'https://shop.example.com/product' });
        await SerpCheckService.checkPosition('Query', 'example.com'); expect(mocks.fetch).toHaveBeenCalledOnce(); expect(mocks.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });
    it('only caches not-found after all searched pages succeed', async () => {
        mocks.fetch.mockResolvedValue(page()); expect((await SerpCheckService.checkPosition('Query', 'example.com')).position).toBeNull(); expect(mocks.fetch).toHaveBeenCalledTimes(3);
        await SerpCheckService.checkPosition('Query', 'example.com'); expect(mocks.fetch).toHaveBeenCalledTimes(3);
    });
    it.each([429, 503])('surfaces provider status %s without caching a false missing rank', async status => {
        mocks.fetch.mockResolvedValueOnce({ ok: false, status });
        await expect(SerpCheckService.checkPosition('Query', 'example.com')).rejects.toThrow(String(status));
        mocks.fetch.mockResolvedValue(page([{ link: 'https://example.com/product' }]));
        expect((await SerpCheckService.checkPosition('Query', 'example.com')).position).toBe(1);
    });
    it('rejects malformed successful responses', async () => {
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ items: 'bad' }) });
        await expect(SerpCheckService.checkPosition('Query', 'example.com')).rejects.toThrow('Invalid');
    });
    it('fails a bulk check before consumers can persist incomplete positions', async () => {
        mocks.fetch.mockRejectedValue(new Error('Network failure'));
        await expect(SerpCheckService.checkPositionsBulk(['Query', 'Other'], 'example.com')).rejects.toThrow('Network failure');
    });
});
