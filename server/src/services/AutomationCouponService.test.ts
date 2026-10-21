import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ enrollment: vi.fn(), upsert: vi.fn(), claim: vi.fn(), update: vi.fn(), create: vi.fn(), woo: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { automationEnrollment: { findFirst: m.enrollment }, generatedCoupon: { upsert: m.upsert, updateMany: m.claim, update: m.update } } }));
vi.mock('./woo', () => ({ WooService: { forAccount: m.woo } }));
import { AutomationCouponService } from './AutomationCouponService';
const input = { accountId: 'tenant', automationId: 'flow', enrollmentId: 'enroll', nodeId: 'node', config: {} };
const record = () => ({ id: 'coupon', code: 'OS-RESERVED', amount: { toFixed: () => '10.00', valueOf: () => 10 }, discountType: 'percent', expiresAt: new Date('2027-01-01'), metadata: { individualUse: true }, wooCouponId: null });
beforeEach(() => { vi.resetAllMocks(); m.enrollment.mockResolvedValue({ id: 'enroll' }); m.upsert.mockImplementation(async () => record()); m.claim.mockResolvedValue({ count: 1 }); m.woo.mockResolvedValue({ createCoupon: m.create }); m.create.mockResolvedValue({ id: 4, code: 'os-reserved' }); });
describe('durable automation coupon actions', () => {
    it('reserves and claims a node-specific code before provider creation', async () => {
        expect(await new AutomationCouponService().generateCoupon(input)).toMatchObject({ wooCouponId: 4, code: 'OS-RESERVED' });
        expect(m.upsert.mock.calls[0][0].where.accountId_enrollmentId_nodeId).toEqual({ accountId: 'tenant', enrollmentId: 'enroll', nodeId: 'node' });
        expect(m.upsert.mock.invocationCallOrder[0]).toBeLessThan(m.create.mock.invocationCallOrder[0]);
        expect(m.claim.mock.invocationCallOrder[0]).toBeLessThan(m.create.mock.invocationCallOrder[0]);
    });
    it('accepts validated numeric text from the flow editor', async () => {
        expect((await new AutomationCouponService().generateCoupon({ ...input, config: { amount: '10.50', expiryDays: '7' } })).wooCouponId).toBe(4);
    });
    it('does not create another coupon after an ambiguous/lost claim', async () => {
        m.claim.mockResolvedValue({ count: 0 }); await expect(new AutomationCouponService().generateCoupon(input)).rejects.toThrow('reconcile'); expect(m.create).not.toHaveBeenCalled();
    });
    it('returns a previously confirmed action without another provider call', async () => {
        m.upsert.mockResolvedValue({ ...record(), wooCouponId: 5 }); expect((await new AutomationCouponService().generateCoupon(input)).wooCouponId).toBe(5); expect(m.claim).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
    });
    it('requires account/enrollment ownership and a provider ID/code confirmation', async () => {
        m.enrollment.mockResolvedValueOnce(null); await expect(new AutomationCouponService().generateCoupon(input)).rejects.toThrow('not found'); expect(m.upsert).not.toHaveBeenCalled();
        m.create.mockResolvedValue({ code: 'os-reserved' }); await expect(new AutomationCouponService().generateCoupon(input)).rejects.toThrow('confirmation'); expect(m.update).not.toHaveBeenCalled();
    });
    it.each([{ amount: 101 }, { amount: '12x' }, { expiryDays: 1.5 }, { discountType: 'invalid' }, { codePrefix: '../' }])('rejects invalid coupon config %j', async config => {
        await expect(new AutomationCouponService().generateCoupon({ ...input, config } as any)).rejects.toThrow(); expect(m.create).not.toHaveBeenCalled();
    });
});
