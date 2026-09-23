import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ permissions: {} as Record<string, boolean>, read: vi.fn(), auth: true }));
vi.mock('../../middleware/auth', () => ({ requireAuthFastify: async (req: any, reply: any) => { if (!m.auth) return reply.code(401).send({ error: 'No token' }); req.user = { id: 'actor' }; req.accountId = 'tenant'; } }));
vi.mock('../../services/PermissionService', () => ({ PermissionService: { resolvePermissions: async () => m.permissions } }));
vi.mock('../../utils/prisma', () => ({ prisma: {} }));
vi.mock('../../services/StockWriteOffService', async importOriginal => ({ ...await importOriginal<any>(), listWriteOffs: m.read, saveWriteOff: m.read, getWriteOff: m.read, writeOffProducts: m.read, finalizeWriteOff: m.read, deleteWriteOff: m.read }));
import { stockWriteOffRoutes } from './write-offs';
describe('write-off route authorization and validation', () => {
    let app: ReturnType<typeof Fastify>;
    beforeEach(async () => { vi.clearAllMocks(); m.auth = true; m.permissions = { manage_inventory: true, view_cogs: true }; m.read.mockResolvedValue({ items: [] }); app = Fastify(); await app.register(stockWriteOffRoutes, { prefix: '/api/inventory' }); });
    afterEach(async () => { await app.close(); });
    const endpoints = [ ['GET', ''], ['GET', '/products'], ['GET', '/report'], ['GET', '/id'], ['POST', ''], ['PUT', '/id'], ['DELETE', '/id'], ['POST', '/id/finalize'] ] as const;
    it.each(endpoints)('requires BOTH permissions for %s %s', async (method, path) => {
        for (const permissions of [{}, { manage_inventory: true }, { view_cogs: true }]) {
            m.permissions = permissions;
            expect((await app.inject({ method, url: `/api/inventory/write-offs${path}` })).statusCode).toBe(403);
        }
        expect(m.read).not.toHaveBeenCalled();
    });
    it('rejects unauthenticated requests', async () => { m.auth = false; expect((await app.inject('/api/inventory/write-offs')).statusCode).toBe(401); expect(m.read).not.toHaveBeenCalled(); });
    it('allows wildcard and forwards trusted tenant context', async () => {
        m.permissions = { '*': true };
        expect((await app.inject('/api/inventory/write-offs?page=2')).statusCode).toBe(200);
        expect(m.read).toHaveBeenCalledWith('tenant', { page: 2 });
    });
    it('rejects client-manufactured status/tenant and invalid report dates', async () => {
        expect((await app.inject({ method: 'POST', url: '/api/inventory/write-offs', payload: { accountId: 'other', status: 'FINALIZED', reason: 'DAMAGED', items: [{ productId: 'p', quantity: 1 }] } })).statusCode).toBe(400);
        expect((await app.inject('/api/inventory/write-offs/report?from=2026-02-30')).statusCode).toBe(400);
        expect(m.read).not.toHaveBeenCalled();
    });
    it('accepts Woo variation IDs and explicit zero overrides', async () => {
        const body = { reason: 'DAMAGED', items: [{ productId: 'p', variationId: 123, quantity: 2, unitCostOverride: 0 }] };
        expect((await app.inject({ method: 'POST', url: '/api/inventory/write-offs', payload: body })).statusCode).toBe(201);
        expect(m.read).toHaveBeenCalledWith('tenant', 'actor', body);
    });
    it('finalizes only the URL document under the authenticated tenant and actor', async () => {
        expect((await app.inject({ method: 'POST', url: '/api/inventory/write-offs/id/finalize', payload: { accountId: 'other', actorId: 'forged', id: 'different' } })).statusCode).toBe(200);
        expect(m.read).toHaveBeenCalledWith('tenant', 'actor', 'id');
    });
});
