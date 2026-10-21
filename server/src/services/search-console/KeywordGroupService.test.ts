import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), list: vi.fn(), group: vi.fn(), assign: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { $transaction: m.transaction, keywordGroup: { update: m.update, findMany: m.list } } }));
import { KeywordGroupService as service } from './KeywordGroupService';
beforeEach(() => { vi.resetAllMocks(); m.transaction.mockImplementation(task => task({ $queryRaw: m.lock, keywordGroup: { count: m.count, create: m.create, findFirst: m.group }, trackedKeyword: { updateMany: m.assign } })); m.count.mockResolvedValue(0); m.create.mockResolvedValue({ id: 'group', keywords: [] }); m.group.mockResolvedValue({ id: 'group' }); });
describe('keyword group quotas and complete assignments', () => {
    it('locks the tenant before checking quota and creating a group', async () => {
        await service.createGroup('tenant', ' Group '); expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.count.mock.invocationCallOrder[0]); expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: { accountId: 'tenant', name: 'Group', color: '#6366f1' } }));
    });
    it('rejects quota exhaustion and invalid updates', async () => {
        m.count.mockResolvedValue(20); await expect(service.createGroup('tenant', 'Group')).rejects.toThrow('Maximum'); expect(m.create).not.toHaveBeenCalled();
        for (const data of [{ name: ' ' }, { color: '<script>' }]) await expect(service.updateGroup('tenant', 'group', data)).rejects.toThrow(); expect(m.update).not.toHaveBeenCalled();
    });
    it('rejects partial assignments inside a transaction and deduplicates inputs', async () => {
        m.assign.mockResolvedValue({ count: 1 }); await expect(service.bulkAssign('tenant', ['a', 'b'], 'group')).rejects.toThrow('no assignments');
        expect(await service.bulkAssign('tenant', ['a', 'a'], 'group')).toBe(1); expect(m.assign.mock.calls[1][0].where.id.in).toEqual(['a']);
    });
    it('does not report unknown keyword metrics as zero', async () => {
        m.list.mockResolvedValue([{ keywords: [{ currentClicks: null, currentImpressions: null, currentPosition: null }] }]); expect((await service.listGroups('tenant'))[0]).toMatchObject({ totalClicks: null, totalImpressions: null, metricCoverage: 0, avgPosition: null });
    });
});
