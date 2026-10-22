import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), workspace: vi.fn(), save: vi.fn(), publish: vi.fn(), simulate: vi.fn() }));
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: mocks.permission } }));
vi.mock('../services/MarketingDraftService', () => ({ MarketingDraftService: class { workspace = mocks.workspace; save = mocks.save; publish = mocks.publish; } }));
vi.mock('../services/MarketingAudienceService', () => ({ MarketingAudienceService: class {} }));
vi.mock('../services/AutomationContextService', () => ({ automationContextService: {} }));
vi.mock('../services/automation/FlowSimulation', () => ({ simulateFlow: mocks.simulate }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/getDefaultEmailAccount', () => ({ getDefaultEmailAccount: vi.fn() }));
import { marketingWorkspaceRoutes } from './marketingWorkspace';
beforeEach(() => { vi.clearAllMocks(); mocks.permission.mockResolvedValue(true); mocks.workspace.mockResolvedValue({ id: 'flow' }); mocks.save.mockResolvedValue({ draftRevision: 1 }); mocks.publish.mockResolvedValue({ draftRevision: 2 }); mocks.simulate.mockReturnValue({ steps: [], note: 'No actions performed' }); });
async function request(method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) {
    const app = Fastify(); app.addHook('preHandler', async request => { request.accountId = 'account'; request.user = { id: 'user' } as any; });
    await app.register(marketingWorkspaceRoutes);
    const result = await app.inject({ method, url, payload }); await app.close(); return result;
}
describe('marketing workspace permissions and bounds', () => {
    it('uses view permission for reads and account-scopes the workspace lookup', async () => {
        expect((await request('GET', '/automations/flow/workspace')).statusCode).toBe(200);
        expect(mocks.permission).toHaveBeenCalledWith('user', 'account', 'view_marketing');
        expect(mocks.workspace).toHaveBeenCalledWith('account', 'flow');
    });
    it('denies draft writes without management permission', async () => {
        mocks.permission.mockResolvedValue(false);
        expect((await request('PUT', '/automations/flow/draft', { revision: 0, flowDefinition: { nodes: [], edges: [] } })).statusCode).toBe(403);
        expect(mocks.save).not.toHaveBeenCalled();
    });
    it.each([{ flowDefinition: { nodes: [], edges: [] } }, { revision: -1, flowDefinition: { nodes: [], edges: [] } }, { revision: 0, flowDefinition: { nodes: [null], edges: [] } }])('rejects malformed/stale-format draft input', async payload => {
        expect((await request('PUT', '/automations/flow/draft', payload)).statusCode).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
    });
    it('returns a conflict without swallowing an unsuccessful CAS', async () => {
        mocks.save.mockRejectedValue(Object.assign(new Error('Stale draft'), { statusCode: 409 }));
        const result = await request('PUT', '/automations/flow/draft', { revision: 0, flowDefinition: { nodes: [], edges: [] } });
        expect(result.statusCode).toBe(409); expect(result.json().error).toBe('Stale draft');
    });
    it('publishes only a revision-bound explicit management request', async () => {
        expect((await request('POST', '/automations/flow/publish', { revision: 1 })).statusCode).toBe(200);
        expect(mocks.permission).toHaveBeenCalledWith('user', 'account', 'manage_marketing');
        expect(mocks.publish).toHaveBeenCalledWith('account', 'flow', 1);
    });
    it('allows read-only simulation without calling a mutation service', async () => {
        expect((await request('POST', '/automations/flow/simulate', { flowDefinition: { nodes: [], edges: [] } })).statusCode).toBe(200);
        expect(mocks.permission).toHaveBeenCalledWith('user', 'account', 'view_marketing');
        expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
    });
});
