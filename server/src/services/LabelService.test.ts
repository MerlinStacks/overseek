import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ label: vi.fn(), conversation: vi.fn(), createMany: vi.fn(), assignment: vi.fn(), trigger: vi.fn(), create: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { conversation: { findFirst: m.conversation }, conversationLabel: { findFirst: m.label, create: m.create }, conversationLabelAssignment: { createMany: m.createMany, findUniqueOrThrow: m.assignment } } }));
vi.mock('./AutomationEngine', () => ({ AutomationEngine: class { processTrigger = m.trigger; } }));
vi.mock('../utils/logger', () => ({ Logger: { debug: vi.fn(), error: vi.fn() } }));
import { LabelService } from './LabelService';
beforeEach(() => { vi.resetAllMocks(); m.label.mockResolvedValue({ id: 'label' }); m.conversation.mockResolvedValue({ id: 'conversation' }); m.assignment.mockResolvedValue({ label: { name: 'Label' }, conversation: { accountId: 'a' } }); });
describe('idempotent label assignment', () => {
    it('does not rerun automation for an existing assignment', async () => {
        m.createMany.mockResolvedValue({ count: 0 }); await new LabelService().assignLabel('a', 'conversation', 'label'); expect(m.trigger).not.toHaveBeenCalled();
    });
    it('triggers only a newly created label and isolates rejected automation from the successful mutation', async () => {
        m.createMany.mockResolvedValue({ count: 1 }); m.trigger.mockRejectedValue(new Error('Automation failed'));
        await expect(new LabelService().assignLabel('a', 'conversation', 'label')).resolves.toHaveProperty('label.name', 'Label'); expect(m.trigger).toHaveBeenCalledExactlyOnceWith('a', 'TAG_ADDED', { conversationId: 'conversation', labelId: 'label', labelName: 'Label' });
    });
    it('rejects blank trimmed names before writing', async () => {
        await expect(new LabelService().createLabel({ accountId: 'a', name: '   ' })).rejects.toThrow(); expect(m.create).not.toHaveBeenCalled();
    });
});
