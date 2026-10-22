import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: vi.fn(), fetch: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { account: { findUnique: m.account } } }));
vi.mock('../../utils/logger', () => ({ Logger: { debug: vi.fn(), warn: vi.fn() } }));
import { AdCopyGenerator } from './AdCopyGenerator';
beforeEach(() => { vi.clearAllMocks(); m.account.mockResolvedValue({ openRouterApiKey: null }); vi.stubGlobal('fetch', m.fetch); });
afterEach(() => vi.unstubAllGlobals());
const context = { storeName: 'Store', storeUrl: 'https://store.test', topProducts: [{ name: 'Ring' }], avgOrderValue: null };
it('does not invent prices, shipping, guarantees, ratings or scarcity in fallback copy', async () => {
    const copy = await AdCopyGenerator.generate('a', context); expect(copy.source).toBe('template'); expect(JSON.stringify(copy)).not.toMatch(/free shipping|guarantee|thousands|limited time|From \$/i);
    const meta = await AdCopyGenerator.generateForMeta('a', context); expect(meta.headlines.length).toBeLessThanOrEqual(5); expect(meta.descriptions).toEqual([]);
});
it('rejects incomplete or malformed provider JSON instead of salvaging quoted fragments', async () => {
    m.account.mockResolvedValue({ openRouterApiKey: 'fake', aiModel: 'model' }); m.fetch.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '["some salvaged text' } }] }), { headers: { 'content-type': 'application/json' } }));
    expect((await AdCopyGenerator.generate('a', context)).source).toBe('template'); expect(m.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal); expect(JSON.parse(m.fetch.mock.calls[0][1].body).messages[0].role).toBe('system');
});
