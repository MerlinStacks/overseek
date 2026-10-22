import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEmailDesignV2 } from '@overseek/core';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { emailSectionPreset: { findMany: mocks.list, create: mocks.create, updateMany: mocks.update } } }));
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: mocks.permission } }));
import { marketingDesignerRoutes } from './marketingDesigner';
beforeEach(() => { vi.clearAllMocks(); mocks.permission.mockResolvedValue(true); mocks.list.mockResolvedValue([]); mocks.update.mockResolvedValue({ count: 1 }); });
async function request(method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) {
    const app = Fastify(); app.addHook('preHandler', async request => { request.accountId = 'account-a'; request.user = { id: 'user' } as any; });
    await app.register(marketingDesignerRoutes); const response = await app.inject({ method, url, payload }); await app.close(); return response;
}
describe('brand section library boundaries', () => {
    const section = createDefaultEmailDesignV2().document.sections[0];
    it('scopes reads to the account and requires view permission', async () => {
        expect((await request('GET', '/designer/sections')).statusCode).toBe(200);
        expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'account-a' } }));
        expect(mocks.permission).toHaveBeenCalledWith('user', 'account-a', 'view_marketing');
    });
    it('prevents unauthorized writes', async () => {
        mocks.permission.mockResolvedValue(false);
        expect((await request('POST', '/designer/sections', { name: 'Header', section })).statusCode).toBe(403);
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('updates only the matching tenant and revision', async () => {
        expect((await request('PUT', '/designer/sections/preset', { name: 'Header', section, version: 2 })).statusCode).toBe(200);
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'preset', accountId: 'account-a', version: 2 }, data: expect.objectContaining({ version: { increment: 1 } }) }));
    });
    it('returns a conflict for foreign or stale sources and rejects malformed sections', async () => {
        mocks.update.mockResolvedValue({ count: 0 });
        expect((await request('PUT', '/designer/sections/foreign', { name: 'Header', section, version: 2 })).statusCode).toBe(409);
        expect((await request('POST', '/designer/sections', { name: 'Header', section: { columns: [] } })).statusCode).toBe(400);
    });
});
