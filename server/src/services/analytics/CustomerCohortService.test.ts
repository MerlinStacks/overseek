import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ orders: vi.fn(), sessions: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { wooOrder: { findMany: m.orders }, analyticsSession: { findMany: m.sessions } } }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
import { CustomerCohortService as service } from './CustomerCohortService';
const order = (date: Date, email: unknown, id = 1) => ({ dateCreated: date, total: 10, currency: 'AUD', rawData: { billing: { email }, customer_id: id, line_items: [] } });
beforeEach(() => { vi.resetAllMocks(); m.sessions.mockResolvedValue([]); });
describe('cohort history and observation coverage', () => {
    it('does not treat an existing customer as first acquired inside the report window', async () => {
        const old = new Date(); old.setFullYear(old.getFullYear() - 2);
        m.orders.mockResolvedValue([order(old, 'old@test.example'), order(new Date(), 'old@test.example'), order(new Date(), 'new@test.example', 2)]);
        const result = await service.getRetentionCohorts('tenant'); expect(result).toHaveLength(1); expect(result[0].totalCustomers).toBe(1); expect(result[0].retention).toEqual([]);
        expect(m.orders.mock.calls[0][0].where.dateCreated.gte).toBeUndefined();
    });
    it('fails explicitly instead of returning silent partial coverage', async () => {
        m.orders.mockResolvedValue(Array(50001).fill(order(new Date(), 'a@test.example'))); await expect(service.getProductCohorts('tenant')).rejects.toThrow('50,000');
    });
    it('never attributes first purchase to a later session', async () => {
        const first = new Date('2026-01-01'); m.orders.mockResolvedValue([order(first, 'a@test.example')]); m.sessions.mockResolvedValue([{ wooCustomerId: 1, createdAt: new Date('2026-02-01'), utmSource: 'google' }]);
        const result = await service.getAcquisitionCohorts('tenant'); expect(result[0].source).toBe('Unknown'); expect(m.sessions.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    });
    it('does not crash on malformed billing values', async () => {
        m.orders.mockResolvedValue([order(new Date(), 123, 0)]); expect(await service.getRetentionCohorts('tenant')).toEqual([]);
    });
});
