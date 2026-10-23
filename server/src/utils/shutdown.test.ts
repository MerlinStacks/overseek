import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ disconnect: vi.fn(), quit: vi.fn() }));
vi.mock('./prisma', () => ({ prisma: { $disconnect: mocks.disconnect } }));
vi.mock('./redis', () => ({ redisClient: { quit: mocks.quit } }));
vi.mock('./logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
describe('graceful shutdown ordering', () => {
    const listeners = new Map<string, () => Promise<void>>();
    beforeEach(() => {
        vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); listeners.clear();
        vi.spyOn(process, 'on').mockImplementation(((signal: string, listener: () => Promise<void>) => { listeners.set(signal, listener); return process; }) as typeof process.on);
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    });
    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
    it('keeps dependencies open until both requests and drain callbacks finish', async () => {
        const { initGracefulShutdown, onShutdown } = await import('./shutdown');
        let close!: () => void; const server = { close: vi.fn(callback => { close = callback; }) };
        const drain = vi.fn().mockResolvedValue(undefined), resources = vi.fn().mockResolvedValue(undefined);
        onShutdown(drain); onShutdown(resources, 'resources'); initGracefulShutdown(server as unknown as Server);
        const pending = listeners.get('SIGTERM')!(); await vi.advanceTimersByTimeAsync(0);
        expect(drain).toHaveBeenCalledOnce(); expect(resources).not.toHaveBeenCalled(); expect(mocks.disconnect).not.toHaveBeenCalled();
        close(); await pending;
        expect(resources.mock.invocationCallOrder[0]).toBeLessThan(mocks.disconnect.mock.invocationCallOrder[0]);
        expect(mocks.quit).toHaveBeenCalledOnce(); expect(process.exit).toHaveBeenCalledWith(0); expect(vi.getTimerCount()).toBe(0);
    });
    it('contains callback failures, continues cleanup, and exits nonzero', async () => {
        const { initGracefulShutdown, onShutdown } = await import('./shutdown');
        onShutdown(async () => { throw new Error('Drain failed'); });
        initGracefulShutdown({ close: (callback: () => void) => callback() } as unknown as Server);
        await listeners.get('SIGTERM')!(); expect(mocks.disconnect).toHaveBeenCalledOnce(); expect(mocks.quit).toHaveBeenCalledOnce(); expect(process.exit).toHaveBeenCalledWith(1);
    });
    it('ignores duplicate signals and retains the hard timeout for hanging requests', async () => {
        const { initGracefulShutdown } = await import('./shutdown');
        const close = vi.fn(); initGracefulShutdown({ close } as unknown as Server);
        void listeners.get('SIGTERM')!(); await listeners.get('SIGINT')!();
        await vi.advanceTimersByTimeAsync(120000);
        expect(close).toHaveBeenCalledOnce(); expect(process.exit).toHaveBeenCalledWith(1); expect(mocks.disconnect).not.toHaveBeenCalled();
    });
});
