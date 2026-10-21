import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { platformCredentials: m } }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
import { clearCredentialsCache, getCredentials } from './ads/types';
import { SerpCheckService } from './search-console/SerpCheckService';
beforeEach(() => { vi.resetAllMocks(); clearCredentialsCache(); SerpCheckService.clearCache(); for (const key of ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_CUSTOM_SEARCH_API_KEY', 'GOOGLE_CUSTOM_SEARCH_ENGINE_ID']) vi.stubEnv(key, undefined); });
afterEach(() => vi.unstubAllEnvs());
describe('credential cache invalidation during in-flight reads', () => {
    it('does not repopulate deleted Google Ads credentials from an obsolete read', async () => {
        let resolve!: (value: unknown) => void; m.findUnique.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(null);
        const pending = getCredentials('GOOGLE_ADS'); clearCredentialsCache(); resolve({ credentials: { clientSecret: 'obsolete-secret' } }); expect(await pending).toBeNull(); expect(m.findUnique).toHaveBeenCalledTimes(2);
    });
    it('does not repopulate deleted Custom Search credentials from an obsolete read', async () => {
        let resolve!: (value: unknown) => void; m.findUnique.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(null);
        const pending = (SerpCheckService as any).getCredentials(); SerpCheckService.clearCache(); resolve({ credentials: { apiKey: 'obsolete-secret', searchEngineId: 'engine' } }); expect(await pending).toBeNull(); expect(m.findUnique).toHaveBeenCalledTimes(2);
    });
});
