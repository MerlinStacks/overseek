import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ deletes: vi.fn(), bulkDelete: vi.fn(), transaction: vi.fn() }));
vi.mock('dexie', () => ({ default: class {
    orders = { where: () => ({ equals: (id: string) => ({ delete: () => m.deletes('orders', id) }) }) };
    products = { where: () => ({ equals: (id: string) => ({ delete: () => m.deletes('products', id) }) }) };
    customers = { where: () => ({ equals: (id: string) => ({ delete: () => m.deletes('customers', id) }) }) };
    meta = { bulkDelete: m.bulkDelete };
    version() { return { stores: () => {
        this.orders = { where: () => ({ equals: (id: string) => ({ delete: () => m.deletes('orders', id) }) }) };
        this.products = { where: () => ({ equals: (id: string) => ({ delete: () => m.deletes('products', id) }) }) };
        this.customers = { where: () => ({ equals: (id: string) => ({ delete: () => m.deletes('customers', id) }) }) };
        this.meta = { bulkDelete: m.bulkDelete };
    } }; }
    transaction(mode: string, tables: unknown[], work: () => Promise<void>) { m.transaction(mode, tables); return work(); }
} }));
import { clearAccountCache } from './db';
beforeEach(() => vi.clearAllMocks());
describe('account cache deletion', () => {
    it('deletes exact account metadata keys in one transaction, never substring matches', async () => {
        await clearAccountCache('acct'); expect(m.transaction).toHaveBeenCalledOnce(); expect(m.deletes.mock.calls).toEqual([['orders', 'acct'], ['products', 'acct'], ['customers', 'acct']]);
        expect(m.bulkDelete).toHaveBeenCalledExactlyOnceWith(['lastSync:orders:acct', 'lastSync:products:acct', 'lastSync:customers:acct']);
    });
    it('rejects missing account scope', async () => { await expect(clearAccountCache('')).rejects.toThrow('Account required'); expect(m.deletes).not.toHaveBeenCalled(); });
});
