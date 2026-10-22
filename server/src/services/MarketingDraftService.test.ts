import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), validate: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { marketingAutomation: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } } }));
vi.mock('./automation/FlowValidation', () => ({ assertAutomationFlowCanRun: mocks.validate }));
import { MarketingDraftService } from './MarketingDraftService';

const live = { nodes: [{ id: 'trigger', type: 'trigger', data: { config: { triggerType: 'ORDER_CREATED' } } }], edges: [] };
const draft = { ...live, edges: [{ source: 'trigger', target: 'email' }] };
beforeEach(() => { vi.clearAllMocks(); mocks.updateMany.mockResolvedValue({ count: 1 }); });
describe('draft and published flow separation', () => {
    it('returns a draft to editors without replacing the published definition', async () => {
        mocks.findFirst.mockResolvedValue({ flowDefinition: live, draftDefinition: draft, draftRevision: 2 });
        expect(await new MarketingDraftService().workspace('account', 'flow')).toMatchObject({ flowDefinition: draft, publishedDefinition: live, hasUnpublishedChanges: true });
        expect(mocks.findFirst).toHaveBeenCalledWith({ where: { accountId: 'account', id: 'flow' } });
    });
    it('saves only draft fields using a tenant-scoped revision compare-and-swap', async () => {
        const result = await new MarketingDraftService().save('account', 'flow', 2, draft);
        const input = mocks.updateMany.mock.calls[0][0];
        expect(input.where).toEqual({ accountId: 'account', id: 'flow', draftRevision: 2 });
        expect(input.data).not.toHaveProperty('flowDefinition'); expect(input.data).not.toHaveProperty('isActive');
        expect(result.draftRevision).toBe(3);
    });
    it('rejects a stale editor instead of overwriting another draft', async () => {
        mocks.updateMany.mockResolvedValue({ count: 0 });
        await expect(new MarketingDraftService().save('account', 'flow', 1, draft)).rejects.toMatchObject({ statusCode: 409 });
    });
    it('publishes the exact validated revision without enabling a paused flow', async () => {
        mocks.findFirst.mockResolvedValue({ flowDefinition: live, draftDefinition: draft, draftRevision: 2 });
        const result = await new MarketingDraftService().publish('account', 'flow', 2);
        expect(mocks.validate).toHaveBeenCalledWith(draft);
        const input = mocks.updateMany.mock.calls[0][0];
        expect(input.where).toEqual({ accountId: 'account', id: 'flow', draftRevision: 2 });
        expect(input.data.flowDefinition).toEqual(draft); expect(input.data).not.toHaveProperty('isActive');
        expect(result.hasUnpublishedChanges).toBe(false);
    });
    it('rejects a publish if the draft changed after validation', async () => {
        mocks.findFirst.mockResolvedValue({ draftDefinition: draft }); mocks.updateMany.mockResolvedValue({ count: 0 });
        await expect(new MarketingDraftService().publish('account', 'flow', 2)).rejects.toMatchObject({ statusCode: 409 });
    });
    it('does not publish a definition that fails validation', async () => {
        mocks.findFirst.mockResolvedValue({ draftDefinition: draft }); mocks.validate.mockImplementationOnce(() => { throw new Error('Invalid flow'); });
        await expect(new MarketingDraftService().publish('account', 'flow', 2)).rejects.toThrow('Invalid flow');
        expect(mocks.updateMany).not.toHaveBeenCalled();
    });
});
