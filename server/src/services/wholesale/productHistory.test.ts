import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ product: vi.fn(), events: vi.fn(), count: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: {
    wooProduct: { findFirst: mocks.product },
    auditLog: { findMany: mocks.events, count: mocks.count },
} }));

import { WholesaleProductService } from './products';

describe('wholesale product history', () => {
    it('scopes product and audit events to the account and paginates results', async () => {
        mocks.product.mockResolvedValue({ id: 'product-1' });
        mocks.events.mockResolvedValue([{ id: 'event-1' }]);
        mocks.count.mockResolvedValue(11);

        const result = await WholesaleProductService.history('account-1', 'product-1', 2, 5);

        expect(mocks.product).toHaveBeenCalledWith({ where: { id: 'product-1', accountId: 'account-1' }, select: { id: true } });
        expect(mocks.events).toHaveBeenCalledWith(expect.objectContaining({ skip: 5, take: 5, where: expect.objectContaining({ accountId: 'account-1', resourceId: 'product-1' }) }));
        expect(result).toMatchObject({ events: [{ id: 'event-1' }], total: 11, page: 2, limit: 5, totalPages: 3 });
    });
});
