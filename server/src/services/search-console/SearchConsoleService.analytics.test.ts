import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../utils/prisma', () => ({ prisma: {} }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('../ads/types', () => ({ getCredentials: vi.fn() }));
import { SearchConsoleService } from './SearchConsoleService';
afterEach(() => vi.restoreAllMocks());
describe('strict search analytics reads', () => {
    it('preserves legacy empty fallback but surfaces failures for strict comparisons', async () => {
        vi.spyOn(SearchConsoleService, 'getActiveAccount').mockResolvedValue({ id: 'sc', siteUrl: 'https://site.test', accessToken: 'token' } as never);
        vi.spyOn(SearchConsoleService as any, 'apiRequest').mockRejectedValue(new Error('Provider unavailable'));
        expect(await SearchConsoleService.getSearchAnalytics('tenant')).toEqual([]);
        await expect(SearchConsoleService.getSearchAnalytics('tenant', { strict: true })).rejects.toThrow('Provider unavailable');
    });
    it('distinguishes no connection from a measured empty result in strict mode', async () => {
        vi.spyOn(SearchConsoleService, 'getActiveAccount').mockResolvedValue(null);
        await expect(SearchConsoleService.getSearchAnalytics('tenant', { strict: true })).rejects.toThrow('not connected');
    });
});
