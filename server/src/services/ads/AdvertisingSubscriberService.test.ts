import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdvertisingSubscribers } from './AdvertisingSubscriberService';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { $queryRaw: mocks.query } }));

describe('Advertising-only subscriber expansion', () => {
    beforeEach(() => { vi.resetAllMocks(); mocks.query.mockResolvedValue([{ email: 'subscriber@example.com' }]); });
    it('tenant-scopes lists, suppressions and guest orders, and excludes existing customers', async () => {
        await getAdvertisingSubscribers('tenant', { type: 'AND', rules: [{ field: 'ordersCount', operator: 'eq', value: 0 }] });
        const sql = mocks.query.mock.calls[0][0];
        expect(sql.text).toContain('m."isSubscribed" = true');
        expect(sql.text).toContain('l."isActive" = true');
        expect(sql.text).toContain('"EmailUnsubscribe"');
        expect(sql.text).toContain('w."accountId" = m."accountId"');
        expect(sql.text).toContain('lower(trim(o."billingEmail")) = s.email');
        expect(sql.values).toContain('tenant');
        expect(sql.text).not.toContain('tenant');
    });
    it('uses identical behavioural predicates for non-customer profiles and safely binds source IDs', async () => {
        const campaignId = "campaign' OR 1=1 --";
        await getAdvertisingSubscribers('tenant', { type: 'AND', rules: [
            { field: 'emailClickedWithinDays', operator: 'within', value: 30, campaignId },
            { field: 'notPurchasedWithinDays', operator: 'within', value: 30 },
        ] });
        const sql = mocks.query.mock.calls[0][0];
        expect(sql.text).toContain('"MessageTrackingEvent"');
        expect(sql.text).toContain('l."accountId" = c."accountId"');
        expect(sql.text).toContain('NOT EXISTS');
        expect(sql.values).toContain(campaignId);
        expect(sql.text).not.toContain(campaignId);
    });
    it('rejects unsupported rules rather than expanding to all subscribers', async () => {
        await expect(getAdvertisingSubscribers('tenant', { type: 'AND', rules: [{ field: 'unknown', operator: 'eq', value: 0 }] })).rejects.toThrow('Unsupported');
        expect(mocks.query).not.toHaveBeenCalled();
    });
});
