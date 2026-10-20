import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
const create = vi.hoisted(() => vi.fn());
vi.mock('../services/InternalProductsService', () => ({ InternalProductsService: { create } }));
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: async () => false } }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'tenant'; request.user = { id: 'user' }; } }));
import routes from './internalProducts';
describe('internal product permissions', () => {
    it('denies inventory mutations before service work', async () => { const app = Fastify(); await app.register(routes); try { expect((await app.inject({ method: 'POST', url: '/', payload: { name: 'Part' } })).statusCode).toBe(403); expect(create).not.toHaveBeenCalled(); } finally { await app.close(); } });
    it('rejects malformed pagination before querying', async () => { const app = Fastify(); await app.register(routes); try { expect((await app.inject('/?limit=-10')).statusCode).toBe(400); } finally { await app.close(); } });
});
