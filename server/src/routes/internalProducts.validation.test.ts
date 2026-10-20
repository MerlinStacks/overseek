import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), adjustStock: vi.fn() }));
vi.mock('../services/InternalProductsService', () => ({ InternalProductsService: mocks }));
vi.mock('../middleware/auth', () => ({ requireAuthFastify: async (request: { accountId: string }) => { request.accountId = 'tenant-1'; } }));

import routes from './internalProducts';

const id = '12345678-1234-4234-8234-123456789012';

describe('internal product request validation', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
        vi.resetAllMocks();
        for (const mock of Object.values(mocks)) mock.mockResolvedValue({ id });
        app = Fastify();
        await app.register(routes);
    });
    afterEach(async () => { await app.close(); });

    it('preserves valid creation including optional fields and zero amounts', async () => {
        const payload = { name: 'Mug', sku: 'MUG-1', stockQuantity: 0, cogs: 0, mainImage: '', images: [] };
        const response = await app.inject({ method: 'POST', url: '/', payload });
        expect(response.statusCode).toBe(201);
        expect(mocks.create).toHaveBeenCalledWith('tenant-1', expect.objectContaining(payload));
    });

    it('strips unknown update fields while preserving the product ID and tenant', async () => {
        const response = await app.inject({
            method: 'PUT', url: `/${id}?ignored=keep`,
            payload: { name: 'Updated Mug', cogs: 0, supplierId: null, accountId: 'other-tenant', unexpected: true },
        });
        expect(response.statusCode).toBe(200);
        expect(mocks.update).toHaveBeenCalledExactlyOnceWith(id, { name: 'Updated Mug', cogs: 0, supplierId: null }, 'tenant-1');
    });

    it('preserves stock adjustment inputs and the route ID', async () => {
        const response = await app.inject({ method: 'POST', url: `/${id}/adjust-stock`, payload: { adjustment: -2, reason: 'Stock correction' } });
        expect(response.statusCode).toBe(200);
        expect(mocks.adjustStock).toHaveBeenCalledWith(id, -2, 'Stock correction', 'USER', 'tenant-1');
    });

    it.each([
        { method: 'POST' as const, url: '/', payload: { name: '' }, path: 'body.name' },
        { method: 'PUT' as const, url: '/invalid-id', payload: { name: 'Mug' }, path: 'params.id' },
        { method: 'POST' as const, url: `/${id}/adjust-stock`, payload: { adjustment: 1.5, reason: 'Correction' }, path: 'body.adjustment' },
    ])('rejects invalid input at $path before calling the service', async ({ method, url, payload, path }) => {
        const response = await app.inject({ method, url, payload });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'Validation failed', details: expect.arrayContaining([expect.objectContaining({ path })]) });
        for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
    });
});
