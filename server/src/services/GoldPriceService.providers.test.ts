import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoldPriceService } from './GoldPriceService';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

vi.mock('../utils/prisma', () => ({ prisma: {
    account: { findUnique: vi.fn(), update: vi.fn() }, notification: { create: vi.fn() },
} }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('GOLD_API_KEY', ''); vi.stubEnv('METALS_API_KEY', '');
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

describe('gold provider compatibility and failure safety', () => {
    it('keeps the public provider usable without any credentials', async () => {
        vi.mocked(fetch).mockResolvedValue(json({ items: [{ xauPrice: 3110.34768 }] }));
        expect(await GoldPriceService.fetchLivePrice('aud')).toBeCloseTo(100);
        expect(fetch).toHaveBeenCalledWith('https://data-asg.goldprice.org/dbXRates/AUD', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });
    it('keeps existing GoldAPI credentials and ounce-to-gram conversion', async () => {
        vi.stubEnv('GOLD_API_KEY', 'existing-key');
        vi.mocked(fetch).mockResolvedValue(json({ price: '3110.34768' }));
        expect(await GoldPriceService.fetchLivePrice('EUR')).toBeCloseTo(100);
        expect(fetch).toHaveBeenCalledExactlyOnceWith('https://www.goldapi.io/api/XAU/EUR', expect.objectContaining({
            headers: expect.objectContaining({ 'x-access-token': 'existing-key' }), signal: expect.any(AbortSignal),
        }));
    });
    it('does not make a doomed demo-key request when the public provider refuses access', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('', { status: 403 }));
        expect(await GoldPriceService.fetchLivePrice()).toBeNull();
        expect(fetch).toHaveBeenCalledOnce();
        expect(Logger.error).toHaveBeenCalledWith(expect.stringContaining('no authenticated provider'), expect.objectContaining({ configurationRequired: 'GOLD_API_KEY or METALS_API_KEY' }));
    });
    it('uses an optional authenticated metals fallback in grams without logging its key', async () => {
        vi.stubEnv('METALS_API_KEY', 'private&key');
        vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValueOnce(json({ metals: { gold: 100 } }));
        expect(await GoldPriceService.fetchLivePrice('AUD')).toBe(100);
        const url = new URL(vi.mocked(fetch).mock.calls[1][0] as string);
        expect(url.searchParams.get('api_key')).toBe('private&key');
        expect(url.searchParams.get('unit')).toBe('g');
        expect(url.searchParams.get('currency')).toBe('AUD');
        expect(JSON.stringify(vi.mocked(Logger.error).mock.calls)).not.toContain('private');
    });
    it('does not expose the credential-bearing URL in fallback transport errors', async () => {
        vi.stubEnv('METALS_API_KEY', 'private-key');
        vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 403 })).mockRejectedValueOnce(new Error('failed https://api.metals.dev/?api_key=private-key'));
        expect(await GoldPriceService.fetchLivePrice()).toBeNull();
        expect(JSON.stringify(vi.mocked(Logger.error).mock.calls)).not.toContain('private-key');
    });
    it.each([0, -1, 'NaN', 'Infinity', '100USD', null])('does not overwrite cached prices with invalid provider value %j', async price => {
        vi.stubEnv('GOLD_API_KEY', 'existing-key');
        vi.mocked(fetch).mockResolvedValue(json({ price }));
        vi.mocked(prisma.account.findUnique).mockResolvedValue({ currency: 'AUD', goldPrice: 228.95,
            goldPriceUpdatedAt: new Date(Date.now() - 273 * 3600000), updatedAt: new Date() } as any);
        await GoldPriceService.updateAccountPrices('tenant');
        expect(prisma.account.update).not.toHaveBeenCalled();
        expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
            accountId: 'tenant', type: 'WARNING', link: '/settings/gold-prices',
        }) }));
        expect(Logger.warn).toHaveBeenCalledWith('[GoldPriceService] API unavailable, using stale cached price', expect.objectContaining({ cachedPrice: 228.95, priceAgeHours: '273.0' }));
    });
});
