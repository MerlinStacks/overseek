import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const context = vi.hoisted(() => ({ accountId: 'account-a' as string | undefined, allowed: true }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = context.accountId; request.user = { id: 'user' }; } }));
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: vi.fn(async () => context.allowed) } }));
vi.mock('../services/sync/SyncFreshness', () => ({ getSyncFreshness: vi.fn() }));
vi.mock('../services/sync', () => ({ SyncService: class {} }));
vi.mock('../services/search/SearchQueryService', () => ({ SearchQueryService: {} }));
vi.mock('../services/search/IndexingService', () => ({ IndexingService: {} }));
vi.mock('../services/scheduler/SyncScheduler', () => ({ SyncScheduler: {} }));
vi.mock('../services/sync/SyncCancellationService', () => ({ SyncCancellationService: {} }));
vi.mock('../services/sync/SyncScheduleService', () => ({ SyncScheduleService: {} }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import routes from './sync';
import { getSyncFreshness } from '../services/sync/SyncFreshness';

describe('account-scoped sync freshness', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => {
        vi.resetAllMocks(); context.accountId = 'account-a'; context.allowed = true;
        vi.mocked(getSyncFreshness).mockResolvedValue({ signals: 1 } as any);
        app = Fastify(); await app.register(routes); await app.ready();
    });
    afterEach(async () => { await app.close(); });
    it('ignores query account overrides and uses the authenticated account', async () => {
        const result = await app.inject('/freshness?accountId=account-b');
        expect(result.statusCode).toBe(200);
        expect(getSyncFreshness).toHaveBeenCalledExactlyOnceWith('account-a');
    });
    it('requires sync-settings permission', async () => {
        context.allowed = false;
        expect((await app.inject('/freshness')).statusCode).toBe(403);
        expect(getSyncFreshness).not.toHaveBeenCalled();
    });
    it('requires account context', async () => {
        context.accountId = undefined;
        expect((await app.inject('/freshness')).statusCode).toBe(400);
        expect(getSyncFreshness).not.toHaveBeenCalled();
    });
    it('returns an explicit unavailable response rather than a healthy empty report', async () => {
        vi.mocked(getSyncFreshness).mockRejectedValueOnce(new Error('DB unavailable'));
        expect((await app.inject('/freshness')).statusCode).toBe(503);
    });
});
