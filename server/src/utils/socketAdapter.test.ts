import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ duplicate: vi.fn(), create: vi.fn(), shutdown: vi.fn() }));
vi.mock('./redis', () => ({ redisClient: { duplicate: mocks.duplicate } }));
vi.mock('@socket.io/redis-adapter', () => ({ createAdapter: mocks.create }));
vi.mock('./shutdown', () => ({ onShutdown: mocks.shutdown }));
vi.mock('./logger', () => ({ Logger: { info: vi.fn() } }));
import { createSocketAdapter } from './socketAdapter';
const client = () => ({ status: 'ready', quit: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn() });
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockReturnValue(() => ({})); });
describe('socket adapter connection ownership', () => {
    it('releases both duplicates during resource cleanup, even if one quit fails', async () => {
        const pub = client(), sub = client(); pub.quit.mockRejectedValueOnce(new Error('Offline'));
        mocks.duplicate.mockReturnValueOnce(pub).mockReturnValueOnce(sub);
        createSocketAdapter(); expect(mocks.shutdown.mock.calls[0][1]).toBe('resources');
        await expect(mocks.shutdown.mock.calls[0][0]()).rejects.toThrow('cleanup failed');
        expect(pub.disconnect).toHaveBeenCalledOnce(); expect(sub.disconnect).toHaveBeenCalledOnce(); expect(sub.quit).toHaveBeenCalledOnce();
    });
    it('cleans partial initialization if the second duplication fails', () => {
        const pub = client(); mocks.duplicate.mockReturnValueOnce(pub).mockImplementationOnce(() => { throw new Error('Initialization failed'); });
        expect(createSocketAdapter).toThrow('Initialization failed'); expect(pub.disconnect).toHaveBeenCalledOnce(); expect(mocks.shutdown).not.toHaveBeenCalled();
    });
    it('disconnects offline clients without queueing a quit that could hang forever', async () => {
        const pub = client(), sub = client(); pub.status = sub.status = 'reconnecting';
        mocks.duplicate.mockReturnValueOnce(pub).mockReturnValueOnce(sub); createSocketAdapter(); await mocks.shutdown.mock.calls[0][0]();
        expect(pub.quit).not.toHaveBeenCalled(); expect(pub.disconnect).toHaveBeenCalledOnce(); expect(sub.disconnect).toHaveBeenCalledOnce();
    });
    it('exposes idempotent cleanup for failures while installing an adapter', async () => {
        const pub = client(), sub = client(); mocks.duplicate.mockReturnValueOnce(pub).mockReturnValueOnce(sub);
        const adapter = createSocketAdapter(); await adapter.dispose(); await mocks.shutdown.mock.calls[0][0]();
        expect(pub.quit).toHaveBeenCalledOnce(); expect(sub.quit).toHaveBeenCalledOnce();
    });
});
