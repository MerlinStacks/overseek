import { beforeEach, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ api: { request } }));
import { InventoryService } from './InventoryService';
beforeEach(() => request.mockReset());
it('validates records and forwards scoped cancellable reads', async () => {
    request.mockResolvedValue([{ id: 's', name: 'Supplier', currency: 'USD' }]); const controller = new AbortController();
    expect(await InventoryService.getSuppliers('token', 'account', controller.signal)).toHaveLength(1);
    expect(request).toHaveBeenCalledWith('/api/inventory/suppliers', { token: 'token', accountId: 'account', signal: controller.signal });
});
it.each([{}, [null], [{ id: '', name: 'Invalid' }], [{ id: 'a', name: 'A' }, { id: 'a', name: 'Duplicate' }]])('rejects malformed supplier data %j', async value => {
    request.mockResolvedValue(value); await expect(InventoryService.getSuppliers('token', 'account')).rejects.toThrow(/invalid/);
});
