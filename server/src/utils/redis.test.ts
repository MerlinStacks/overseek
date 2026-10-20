import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>> }));
vi.mock('ioredis', () => ({ default: class {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) { this.options = options; m.options.push(options); }
    on() { return this; }
    duplicate(override?: Record<string, unknown>) { return new (this.constructor as any)({ ...this.options, ...override }); }
} }));
vi.mock('./logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
beforeEach(() => { vi.resetModules(); m.options.length = 0; vi.stubEnv('REDIS_PORT', '6379'); });
afterEach(() => vi.unstubAllEnvs());
describe('Redis connection policies', () => {
    it('bounds API requests while keeping workers and their duplicates persistent', async () => {
        const { redisClient, createWorkerConnection } = await import('./redis');
        expect(redisClient.options).toMatchObject({ commandTimeout: 5000, maxRetriesPerRequest: 2, enableOfflineQueue: false });
        const worker = createWorkerConnection(); expect(worker.options).toMatchObject({ maxRetriesPerRequest: null, enableOfflineQueue: true }); expect(worker.options.commandTimeout).toBeUndefined();
        expect(worker.duplicate().options.maxRetriesPerRequest).toBeNull();
    });
    it.each(['6379oops', '0', '65536', '-1'])('rejects invalid port %s before opening a connection', async port => {
        vi.stubEnv('REDIS_PORT', port); await expect(import('./redis')).rejects.toThrow('REDIS_PORT'); expect(m.options).toHaveLength(0);
    });
});
