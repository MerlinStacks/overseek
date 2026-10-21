import { beforeEach, describe, expect, it, vi } from 'vitest';
import { operationalOptions, assertSearchConfirmation, safeDestination, closeOperationalResources } from './operationalSafety';
import { reindexOrders, main as ordersMain } from './reindex-orders';
import { reindexProducts } from './reindex-products';
import { revokeSessions } from './revoke-all-sessions';
import { diagnose } from './deep-diagnostic';
const connections = vi.hoisted(() => ({ create: vi.fn(), index: vi.fn() }));
vi.mock('../utils/prisma', () => ({ createPrismaClient: connections.create, prisma: { $connect: connections.create } }));
vi.mock('../utils/elastic', () => ({ esClient: { index: connections.index } }));
const now = new Date('2026-10-20T12:00:00Z');
const env = { DATABASE_URL: 'postgresql://user:secret@db:5432/shop?password=hidden' };
const options = (task = 'reindex-orders', extra: string[] = []) => operationalOptions(task, ['--all', ...extra], env, now);
beforeEach(() => { vi.clearAllMocks(); });
describe('operational CLI safety', () => {
    it('imports scripts and displays help without constructing clients', async () => {
        const log = vi.spyOn(console, 'info').mockImplementation(() => {});
        await ordersMain(['--help']); expect(connections.create).not.toHaveBeenCalled(); expect(connections.index).not.toHaveBeenCalled(); log.mockRestore();
    });
    it('defaults to dry-run and logs only a credential-free destination', () => {
        expect(options().apply).toBe(false); expect(safeDestination(env.DATABASE_URL)).toBe('db:5432/shop'); expect(safeDestination('broken:secret')).not.toContain('secret');
    });
    it.each([[], ['--apply'], ['--all', '--account=a'], ['--all', '--limit=1.5'], ['--all', '--before=2026-02-30T00:00:00Z'], ['--all', '--before=2030-01-01T00:00:00Z'], ['--all', '--apply', '--confirm=wrong'], ['--all', '--apply', '--dry-run']])('rejects unsafe or ambiguous options %j', args => {
        expect(() => operationalOptions('reindex-orders', args, env, now)).toThrow();
    });
    it('requires a matching task, scope, database and explicit search destination for indexing', () => {
        const parsed = options('reindex-orders', ['--apply', '--confirm=reindex-orders:ALL:db:5432/shop']); expect(parsed.apply).toBe(true);
        expect(() => assertSearchConfirmation('reindex-orders', parsed, { ...env, ELASTICSEARCH_URL: 'https://user:secret@search:9200' })).toThrow();
        expect(() => assertSearchConfirmation('reindex-orders', parsed, { ...env, ELASTICSEARCH_URL: 'https://search:9200', OPERATIONAL_SEARCH_CONFIRM: 'reindex-orders:search:9200/' })).not.toThrow();
    });
    it('attempts every cleanup even if a previous cleanup fails synchronously', async () => {
        const second = vi.fn().mockResolvedValue(undefined); await expect(closeOperationalResources([() => { throw new Error('Failed close'); }, second])).rejects.toThrow('cleanup failed'); expect(second).toHaveBeenCalledOnce();
    });
});
describe('bounded operational work with mocked dependencies only', () => {
    it('does not index or fetch full order rows during dry-run', async () => {
        const db = { wooOrder: { findFirst: vi.fn().mockResolvedValue({ id: 'z' }), count: vi.fn().mockResolvedValue(3), findMany: vi.fn() } }; const index = vi.fn();
        const result = await reindexOrders(options(), { db: db as any, index, tags: vi.fn() }); expect(result).toMatchObject({ matched: 3, indexed: 0, dryRun: true }); expect(index).not.toHaveBeenCalled(); expect(db.wooOrder.findMany).not.toHaveBeenCalled();
    });
    it('uses keyset traversal, preserves current order fields and tags, and counts failures/skips honestly', async () => {
        const rows = [{ id: 'a', accountId: 'tenant', wooId: 42, total: 20, status: 'completed', currency: 'EUR', dateCreated: now, billingEmail: 'current@test.example', wooCustomerId: 2, rawData: { id: 999, status: 'pending', total: '1', billing: { email: 'old@test.example' }, line_items: [] } }, { id: 'b', rawData: null }];
        const db = { wooOrder: { findFirst: vi.fn().mockResolvedValue({ id: 'z' }), count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]) } }; const index = vi.fn().mockRejectedValue(new Error('Unavailable')); const tags = vi.fn().mockResolvedValue(['VIP']);
        const result = await reindexOrders({ ...options(), apply: true }, { db: db as any, index, tags }); expect(result).toMatchObject({ scanned: 2, skipped: 1, failed: 1, indexed: 0 });
        expect(index).toHaveBeenCalledWith('tenant', expect.objectContaining({ id: 42, status: 'completed', total: '20', currency: 'EUR', billing: { email: 'current@test.example' } }), ['VIP']);
        expect(db.wooOrder.findMany.mock.calls[1][0].where.id).toEqual({ gt: 'b', lte: 'z' });
    });
    it('terminates product traversal on an empty batch even when the count is stale', async () => {
        const db = { wooProduct: { findFirst: vi.fn().mockResolvedValue({ id: 'z' }), count: vi.fn().mockResolvedValue(10), findMany: vi.fn().mockResolvedValue([]) } };
        const result = await reindexProducts({ ...options('reindex-products'), apply: true }, { db: db as any, index: vi.fn() }); expect(result.remaining).toBe(10); expect(db.wooProduct.findMany).toHaveBeenCalledOnce();
    });
    it('never revokes sessions during dry-run, and repeats cutoff/user conditions in conditional writes', async () => {
        const db = { refreshToken: { findFirst: vi.fn().mockResolvedValue({ id: 'z' }), count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValueOnce([{ id: 'session' }]).mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
        const parsed = operationalOptions('revoke-all-sessions', ['--user=user-a', '--before=2026-10-01T00:00:00Z'], env, now);
        await revokeSessions(parsed, db as any); expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
        db.refreshToken.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
        expect(await revokeSessions({ ...parsed, apply: true }, db as any)).toMatchObject({ revoked: 1, remaining: 0 });
        expect(db.refreshToken.updateMany).toHaveBeenCalledWith({ where: { userId: 'user-a', revokedAt: null, createdAt: { lte: parsed.before }, id: { in: ['session'] } }, data: { revokedAt: expect.any(Date) } });
    });
    it('returns aggregate counts only and never queries rows or raw user data', async () => {
        const db = { account: { count: vi.fn().mockResolvedValue(1) }, wooOrder: { count: vi.fn().mockResolvedValue(2) }, wooProduct: { count: vi.fn().mockResolvedValue(3) }, user: { count: vi.fn().mockResolvedValue(4) }, refreshToken: { count: vi.fn().mockResolvedValue(5) }, $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn() };
        expect(await diagnose(options('deep-diagnostic'), db as any)).toEqual({ accounts: 1, orders: 2, products: 3, users: 4, activeRefreshTokens: 5 }); expect(db.$queryRaw).not.toHaveBeenCalled(); expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
    });
});
