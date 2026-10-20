import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { wooCustomer: { findMany: mocks.findMany } } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { CustomerTools } from './CustomerTools';
beforeEach(() => { vi.resetAllMocks(); mocks.findMany.mockResolvedValue([]); });
describe('customer lookup tool', () => {
    it.each(['', ' ', null, undefined, 1, {}])('rejects empty or malformed searches without querying: %j', async query => {
        expect(await CustomerTools.findCustomer('tenant-1', query as string)).toBe('Customer search query required.');
        expect(mocks.findMany).not.toHaveBeenCalled();
    });
    it('does not allow missing tenant context to become an unscoped lookup', async () => {
        expect(await CustomerTools.findCustomer(undefined, 'Alice')).toBe('Account ID required.');
        expect(mocks.findMany).not.toHaveBeenCalled();
    });
    it('trims searches, scopes to the tenant, orders results, and retains the existing result shape', async () => {
        const customers = [{ firstName: 'Alice', email: 'alice@example.com' }];
        mocks.findMany.mockResolvedValue(customers);
        expect(await CustomerTools.findCustomer('tenant-1', ' Alice ')).toBe(customers);
        expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { accountId: 'tenant-1', OR: ['email', 'firstName', 'lastName'].map(key => ({ [key]: { contains: 'Alice', mode: 'insensitive' } })) },
            take: 3, orderBy: [{ email: 'asc' }, { id: 'asc' }],
        }));
    });
    it('preserves empty-result and failure messages', async () => {
        expect(await CustomerTools.findCustomer('tenant-1', 'Alice')).toBe('No customer found.');
        mocks.findMany.mockRejectedValue(new Error('Private detail'));
        expect(await CustomerTools.findCustomer('tenant-1', 'Alice')).toBe('Failed to find customer.');
    });
});
