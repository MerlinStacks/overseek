import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignTrackingService } from './CampaignTrackingService';

const mocks = vi.hoisted(() => ({
    findFirst: vi.fn(), create: vi.fn(), purchase: vi.fn(), lock: vi.fn(), automation: vi.fn(), broadcast: vi.fn()
}));
vi.mock('../utils/prisma', () => ({ prisma: {
    campaignEvent: { findFirst: mocks.findFirst },
    marketingAutomation: { findFirst: mocks.automation },
    marketingCampaign: { findFirst: mocks.broadcast },
    $transaction: async (work: any) => work({
        $queryRaw: mocks.lock, campaignEvent: { findFirst: mocks.purchase, create: mocks.create }
    })
} }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));

describe('CampaignTrackingService purchase attribution', () => {
    const service = new CampaignTrackingService();
    const purchasedAt = new Date('2026-09-20T10:00:00Z');
    const order = { id: 42, status: 'completed', total: '125.50', billing: { email: ' Buyer@Example.com ' }, date_paid_gmt: '2026-09-20T10:00:00', date_created_gmt: '2026-09-19T09:00:00' };

    beforeEach(() => {
        vi.resetAllMocks();
        mocks.findFirst.mockResolvedValue({ campaignId: 'flow', campaignType: 'automation' });
        mocks.purchase.mockResolvedValue(null);
    });

    it('uses the actual purchase time for historical lookup and reporting, not processing time', async () => {
        await service.trackOrderPurchase('account', order);
        expect(mocks.findFirst).toHaveBeenCalledWith({
            where: { accountId: 'account', recipientEmail: { equals: 'buyer@example.com', mode: 'insensitive' },
                eventType: 'send', campaignId: { not: null },
                createdAt: { gte: new Date('2026-09-13T10:00:00Z'), lte: purchasedAt } },
            orderBy: { createdAt: 'desc' }
        });
        expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            accountId: 'account', campaignId: 'flow', campaignType: 'automation', eventType: 'purchase',
            orderId: '42', recipientEmail: 'buyer@example.com', revenue: 125.5, createdAt: purchasedAt
        }) });
        expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), 'campaign-purchase:account:42');
    });

    it('falls back to order creation time when payment time is absent', async () => {
        await service.trackOrderPurchase('account', { ...order, date_paid_gmt: null });
        expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ createdAt: new Date('2026-09-19T09:00:00Z') }) });
    });

    it('does not credit any flow when no message preceded the purchase within seven days', async () => {
        mocks.findFirst.mockResolvedValue(null);
        await service.trackOrderPurchase('account', order);
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('resolves legacy send events without a campaign type', async () => {
        mocks.findFirst.mockResolvedValueOnce({ campaignId: 'flow', campaignType: null }).mockResolvedValueOnce(null);
        mocks.automation.mockResolvedValue({ id: 'flow' });
        await service.trackOrderPurchase('account', order);
        expect(mocks.automation).toHaveBeenCalledWith({ where: { accountId: 'account', id: 'flow' }, select: { id: true } });
        expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ campaignType: 'automation' }) });
    });

    it('deduplicates per account/order even when a different campaign would now win', async () => {
        mocks.purchase.mockResolvedValue({ id: 'previous-purchase' });
        await service.trackOrderPurchase('account', order);
        expect(mocks.purchase).toHaveBeenCalledWith({ where: { accountId: 'account', eventType: 'purchase', orderId: '42' }, select: { id: true } });
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it.each([
        { status: 'pending' }, { status: 'failed' }, { status: 'cancelled' }, { status: 'refunded' },
        { total: 'not-money' }, { total: '0' }, { total: '-20' }, { billing: { email: '' } },
        { date_paid_gmt: 'invalid' }, { date_paid_gmt: null, date_created_gmt: null },
        { date_paid_gmt: '2999-01-01T00:00:00' }
    ])('skips ineligible or incomplete orders: %j', async overrides => {
        await service.trackOrderPurchase('account', { ...order, ...overrides });
        expect(mocks.findFirst).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('propagates storage failures so callers can log and retry them', async () => {
        mocks.create.mockRejectedValue(new Error('database unavailable'));
        await expect(service.trackOrderPurchase('account', order)).rejects.toThrow('database unavailable');
    });
});
