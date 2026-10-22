import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ allowed: true, db: {
    $queryRaw: vi.fn(), $transaction: vi.fn(),
    wooOrder: { findFirst: vi.fn(), updateMany: vi.fn() }, orderTagIndexOutbox: { upsert: vi.fn() },
    bOMItem: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() }, bOM: { count: vi.fn() },
    accountRole: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() }, accountUser: { findMany: vi.fn(), updateMany: vi.fn() },
    dashboardLayout: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() }, dashboardWidget: { deleteMany: vi.fn(), createMany: vi.fn() },
    adSuggestionContext: { upsert: vi.fn() }, recommendationLog: { create: vi.fn() },
}, retention: vi.fn(), acquisition: vi.fn(), product: vi.fn(), invalidate: vi.fn(), live: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: m.db }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/cache', () => ({ cacheAside: async (_key: string, fn: () => unknown) => fn(), CacheTTL: { SHORT: 30 } }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: { accountId: string; user: unknown }) => { request.accountId = 'a'; request.user = { id: 'u', accountId: 'a' }; } }));
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: async () => m.allowed, hasAnyPermission: async () => m.allowed, invalidatePermissions: m.invalidate } }));
vi.mock('../services/analytics/CustomerCohortService', () => ({ CustomerCohortService: { getRetentionCohorts: m.retention, getAcquisitionCohorts: m.acquisition, getProductCohorts: m.product } }));
vi.mock('../services/tools/AdsTools', () => ({ AdsTools: {} }));
vi.mock('../services/woo', () => ({ WooService: { forAccount: async () => ({ getProduct: m.live }) } }));
import roles from './roles'; import tags from './orders/tags'; import { bomManagementRoutes } from './inventory/bomManagement'; import cohorts from './cohorts'; import dashboard from './dashboard';
let app: ReturnType<typeof Fastify>;
const date = new Date('2026-10-20T00:00:00.000Z');
beforeEach(async () => {
    vi.clearAllMocks(); m.allowed = true; m.db.$transaction.mockImplementation(async (task: (tx: typeof m.db) => unknown) => task(m.db)); m.db.$queryRaw.mockResolvedValue([]);
    m.db.wooOrder.findFirst.mockResolvedValue({ id: 'order', wooId: 123, accountId: 'a', updatedAt: date, rawData: { tags: ['50% off'], status: 'processing', other: 'keep' } }); m.db.wooOrder.updateMany.mockResolvedValue({ count: 1 });
    m.db.bOMItem.findFirst.mockResolvedValue({ id: 'i', bomId: 'b', bom: { productId: 'p', product: { accountId: 'a', status: 'publish' } }, childProductId: null, childVariationId: null, internalProductId: 'internal', supplierItemId: null, internalProduct: { id: 'internal', accountId: 'a' }, quantity: 1, wasteFactor: 0, isActive: false, deactivatedReason: 'OLD' }); m.db.bOMItem.updateMany.mockResolvedValue({ count: 1 });
    m.db.accountRole.findFirst.mockResolvedValue({ id: 'r', accountId: 'a' }); m.db.accountUser.findMany.mockResolvedValue([{ userId: 'member' }]); m.db.accountUser.updateMany.mockResolvedValue({ count: 1 });
    m.db.dashboardLayout.findFirst.mockResolvedValue({ id: 'layout', updatedAt: date, widgets: [] }); m.db.dashboardLayout.updateMany.mockResolvedValue({ count: 1 }); m.db.dashboardLayout.findUniqueOrThrow.mockResolvedValue({ id: 'layout', updatedAt: new Date(date.getTime() + 1), widgets: [] });
    m.retention.mockResolvedValue([{ cohortMonth: '2026-10', totalCustomers: 5, retention: [] }]); m.acquisition.mockResolvedValue([]); m.product.mockResolvedValue([]);
    app = Fastify(); app.decorateRequest('accountId', 'a'); await app.register(roles, { prefix: '/roles' }); await app.register(tags, { prefix: '/orders' }); await app.register(bomManagementRoutes, { prefix: '/inventory' }); await app.register(cohorts, { prefix: '/cohorts' }); await app.register(dashboard, { prefix: '/dashboard' });
});
afterEach(async () => { await app.close(); });
it('preserves unobserved retention as unavailable and rejects malformed month windows', async () => {
    const summary = await app.inject('/cohorts/summary'); expect(summary.json().overview.latestCohortRetention).toBeNull(); expect(summary.json().overview.retentionObservation.available).toBe(false);
    expect((await app.inject('/cohorts/retention?months=2junk')).statusCode).toBe(400); expect((await app.inject('/cohorts/retention?months=25')).statusCode).toBe(400);
});
it('gates dashboard context, role management, order tags and BOM reactivation before writes', async () => {
    m.allowed = false;
    for (const [url, payload] of [['/roles', {}], ['/orders/123/tags', { tag: 'x' }], ['/dashboard/ad-suggestions/context', { context: 'x' }]] as const) expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: '/inventory/bom/items/i/reactivate' })).statusCode).toBe(403); expect(m.db.wooOrder.updateMany).not.toHaveBeenCalled(); expect(m.db.bOMItem.updateMany).not.toHaveBeenCalled();
});
it('uses account/version CAS, preserves unrelated rawData and queues indexing transactionally', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/orders/123/tags/50%25%20off' }); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ tags: [], indexing: 'pending' });
    expect(m.db.wooOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'order', accountId: 'a', updatedAt: date }, data: expect.objectContaining({ rawData: { tags: [], status: 'processing', other: 'keep' } }) })); expect(m.db.orderTagIndexOutbox.upsert).toHaveBeenCalledOnce();
    m.db.wooOrder.updateMany.mockResolvedValue({ count: 0 }); expect((await app.inject({ method: 'POST', url: '/orders/123/tags', payload: { tag: 'new' } })).statusCode).toBe(409);
});
it('refuses stale dashboard versions before deleting widgets and validates bounds', async () => {
    expect((await app.inject({ method: 'POST', url: '/dashboard', payload: { widgets: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/dashboard', payload: { version: new Date(0).toISOString(), widgets: [] } })).statusCode).toBe(409); expect(m.db.dashboardWidget.deleteMany).not.toHaveBeenCalled();
    const valid = await app.inject({ method: 'POST', url: '/dashboard', payload: { version: date.toISOString(), widgets: [] } }); expect(valid.statusCode).toBe(200); expect(m.db.dashboardWidget.deleteMany).toHaveBeenCalledWith({ where: { dashboardId: 'layout' } });
});
it('invalidates all affected role members and validates assignments', async () => {
    const updated = await app.inject({ method: 'PUT', url: '/roles/r', payload: { name: 'Updated', permissions: { view_orders: false } } }); expect(updated.statusCode).toBe(200); expect(m.invalidate).toHaveBeenCalledWith('member', 'a');
    expect((await app.inject({ method: 'POST', url: '/roles/assign', payload: { targetUserId: [], roleId: null } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/roles/r' })).statusCode).toBe(409);
});
it('reactivates only validated account-local mappings and rejects CAS changes', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/inventory/bom/items/i/reactivate' })).statusCode).toBe(200);
    m.db.bOMItem.updateMany.mockResolvedValue({ count: 0 }); expect((await app.inject({ method: 'PATCH', url: '/inventory/bom/items/i/reactivate' })).statusCode).toBe(409);
    m.db.bOMItem.findFirst.mockResolvedValue({ ...await m.db.bOMItem.findFirst(), internalProduct: { accountId: 'other' } }); expect((await app.inject({ method: 'PATCH', url: '/inventory/bom/items/i/reactivate' })).statusCode).toBe(409);
});
