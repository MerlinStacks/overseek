import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ active: vi.fn(), fetch: vi.fn(), findMany: vi.fn(), update: vi.fn(), transaction: vi.fn() }));
vi.mock('./SearchConsoleService', () => ({ SearchConsoleService: { getActiveAccount: mocks.active } }));
vi.mock('../../utils/prisma', () => ({ prisma: { trackedKeyword: { findMany: mocks.findMany, update: mocks.update }, $transaction: mocks.transaction } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { CannibalizationService } from './CannibalizationService';
const row = (page: string, keyword = 'Query') => ({ keys: [keyword, `https://site.test/${page}`], clicks: 10, impressions: 30, position: 5 });
beforeEach(() => {
    vi.resetAllMocks(); vi.stubGlobal('fetch', mocks.fetch);
    mocks.active.mockResolvedValue({ siteUrl: 'https://site.test', accessToken: 'token' });
    mocks.findMany.mockResolvedValue([{ id: 'tracked', keyword: 'Query' }, { id: 'obsolete', keyword: 'Old' }]);
    mocks.update.mockReturnValue('operation'); mocks.transaction.mockResolvedValue([]);
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ rows: [row('one'), row('two')] }) });
});
afterEach(() => vi.unstubAllGlobals());
describe('cannibalization scan completeness', () => {
    it('updates current findings and clears obsolete findings only after a valid scan', async () => {
        const result = await CannibalizationService.detectCannibalization('tenant'); expect(result).toHaveLength(1);
        expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'tracked', accountId: 'tenant' }, data: { cannibalizationPages: ['https://site.test/one', 'https://site.test/two'] } });
        expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'obsolete', accountId: 'tenant' }, data: { cannibalizationPages: [] } });
    });
    it('surfaces provider failures without touching persisted findings', async () => {
        mocks.fetch.mockResolvedValue({ ok: false, status: 503 });
        await expect(CannibalizationService.detectCannibalization('tenant')).rejects.toThrow('503');
        expect(mocks.findMany).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
    });
    it('reads subsequent pages before persisting a complete analysis', async () => {
        const rows = Array.from({ length: 5000 }, (_, index) => row(`page-${index}`, `keyword-${index}`));
        mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ rows }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });
        await CannibalizationService.detectCannibalization('tenant');
        expect(mocks.fetch).toHaveBeenCalledTimes(2);
        expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).startRow).toBe(5000);
    });
    it('does not mistake duplicate rows for multiple ranking pages', async () => {
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ rows: [row('one'), row('one')] }) });
        expect(await CannibalizationService.detectCannibalization('tenant')).toEqual([]);
    });
    it('preserves findings on malformed data or when a safety cap prevents completion', async () => {
        mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [{ keys: [] }] }) });
        await expect(CannibalizationService.detectCannibalization('tenant')).rejects.toThrow('Invalid');
        const rows = Array.from({ length: 5000 }, (_, index) => row(`${index}`, `${index}`));
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ rows }) });
        await expect(CannibalizationService.detectCannibalization('tenant')).rejects.toThrow('analysis limit');
        expect(mocks.update).not.toHaveBeenCalled();
    });
});
