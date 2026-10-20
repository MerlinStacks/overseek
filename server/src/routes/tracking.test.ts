import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), fetch: vi.fn(), accountId: 'tenant-1' as string | undefined }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = mocks.accountId; } }));
vi.mock('../utils/prisma', () => ({ prisma: { account: { findUnique: mocks.findUnique } } }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('./trackingIngestion', () => ({ default: async () => {} }));
vi.mock('./trackingDashboard', () => ({ default: async () => {} }));
import routes from './tracking';

describe('store tracking verification', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
        vi.resetAllMocks();
        mocks.accountId = 'tenant-1';
        mocks.findUnique.mockResolvedValue({ wooUrl: 'https://store.example.com/shop/', name: 'Store' });
        vi.stubGlobal('fetch', mocks.fetch);
        app = Fastify();
        await app.register(routes);
        await app.ready();
    });
    afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await app.close(); });
    const verify = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/verify-store' });
    it('recognizes current public plugin health with private details', async () => {
        mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, plugin: 'overseek-wc', version: null, configured: null })));
        const response = await verify(app);
        expect(response.json()).toEqual(expect.objectContaining({ success: true, storeReachable: true, pluginInstalled: true, pluginVersion: 'unknown' }));
        expect(mocks.fetch).toHaveBeenCalledWith('https://store.example.com/shop/wp-json/overseek/v1/health?account_id=tenant-1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });
    it('preserves legacy plugin health responses', async () => {
        mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ version: '2.0', configured: true, accountMatch: true })));
        expect((await verify(app)).json()).toEqual(expect.objectContaining({ success: true, pluginVersion: '2.0', configured: true, accountMatch: true }));
    });
    it.each([{}, [], null, { version: 'unrelated' }, { plugin: 'other', success: true },
        { plugin: 'other', version: '1.0', configured: true }, { plugin: 'overseek-wc', success: false, version: '1.0', configured: true },
    ])('does not identify arbitrary JSON as the plugin: %j', async payload => {
        mocks.fetch.mockResolvedValue(new Response(JSON.stringify(payload)));
        expect((await verify(app)).json()).toEqual(expect.objectContaining({ success: false, storeReachable: true, pluginInstalled: false }));
    });
    it('distinguishes malformed JSON from an unreachable store and clears its timer', async () => {
        vi.useFakeTimers();
        mocks.fetch.mockResolvedValue(new Response('<html>Not JSON</html>'));
        expect((await verify(app)).json()).toEqual(expect.objectContaining({ success: false, storeReachable: true, pluginInstalled: false }));
        await vi.advanceTimersByTimeAsync(10_001);
        expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(false);
    });
    it('clears its timeout after connection failure', async () => {
        vi.useFakeTimers();
        mocks.fetch.mockRejectedValue(new Error('Connection refused'));
        expect((await verify(app)).json()).toEqual(expect.objectContaining({ storeReachable: false, pluginInstalled: false }));
        await vi.advanceTimersByTimeAsync(10_001);
        expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(false);
    });
    it('keeps the timeout active while reading the response body', async () => {
        vi.useFakeTimers();
        mocks.fetch.mockImplementation(async (_url, { signal }) => ({
            ok: true,
            json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
        }));
        const pending = verify(app);
        // Start injection before advancing the clock.
        const result = Promise.resolve(pending);
        await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
        await vi.advanceTimersByTimeAsync(10_001);
        expect((await result).json()).toEqual(expect.objectContaining({ error: 'Connection timed out', storeReachable: true }));
        expect(vi.getTimerCount()).toBe(0);
    });
    it.each([404, 401, 500])('does not claim plugin installation on HTTP %s', async status => {
        mocks.fetch.mockResolvedValue(new Response('', { status }));
        expect((await verify(app)).json()).toEqual(expect.objectContaining({ success: false, storeReachable: true, pluginInstalled: false }));
    });
    it('does not query or fetch without account context', async () => {
        mocks.accountId = undefined;
        expect((await verify(app)).statusCode).toBe(400);
        expect(mocks.findUnique).not.toHaveBeenCalled();
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it('preserves the no-store configuration response', async () => {
        mocks.findUnique.mockResolvedValue(null);
        expect((await verify(app)).json()).toEqual({ success: false, error: 'No store URL configured', storeReachable: false, pluginInstalled: false });
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
});
