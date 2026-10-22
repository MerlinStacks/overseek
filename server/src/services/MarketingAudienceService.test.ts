import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ campaign: vi.fn(), customers: vi.fn(), suppressions: vi.fn(), membership: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { marketingCampaign: { findFirst: mocks.campaign }, wooCustomer: { findMany: mocks.customers }, emailUnsubscribe: { findMany: mocks.suppressions }, emailListMember: { findFirst: mocks.membership } } }));
vi.mock('./SegmentService', () => ({ SegmentService: class {} }));
import { MarketingAudienceService, recipientExclusion } from './MarketingAudienceService';
beforeEach(() => { vi.clearAllMocks(); mocks.customers.mockResolvedValue([]); mocks.suppressions.mockResolvedValue([]); });
describe('recipient eligibility explanations', () => {
    it.each([
        [null, undefined, undefined, false, 'missing_email'], ['bad', undefined, undefined, false, 'invalid_email'],
        ['a@example.com', false, undefined, false, 'unsubscribed'], ['a@example.com', true, 'COMPLAINT', false, 'suppressed'],
        ['a@example.com', true, 'BOUNCED', false, 'suppressed'], ['a@example.com', true, undefined, true, 'suppressed'],
        ['a@example.com', undefined, 'UNVERIFIED', false, 'unverified'], ['a@example.com', true, 'UNVERIFIED', false, null],
        ['a@example.com', undefined, undefined, false, null],
    ] as const)('explains %s / %s / %s', (email, subscribed, status, suppressed, expected) => {
        expect(recipientExclusion(email, subscribed, status, suppressed)).toBe(expected);
    });
    it('reads suppressions and contact classifications only within the current account', async () => {
        mocks.suppressions.mockResolvedValue([{ email: 'A@EXAMPLE.COM' }]);
        expect(await new MarketingAudienceService().exclusions('account', [{ id: 'c', email: 'a@example.com' }])).toEqual(['suppressed']);
        expect(mocks.suppressions.mock.calls[0][0].where.accountId).toBe('account');
        expect(mocks.customers.mock.calls[0][0].where.accountId).toBe('account');
    });
    it('rechecks list membership at delivery instead of trusting the earlier preview', async () => {
        mocks.membership.mockResolvedValue({ isSubscribed: false });
        expect(await new MarketingAudienceService().deliveryExclusion('account', 'a@example.com', 'list')).toBe('unsubscribed');
        expect(mocks.membership.mock.calls[0][0].where).toEqual({ accountId: 'account', listId: 'list', email: { equals: 'a@example.com', mode: 'insensitive' } });
    });
    it.each([['BOUNCED', 'UNVERIFIED'], ['UNVERIFIED', 'BOUNCED']])('keeps the strongest classification across duplicate customer records (%s/%s)', async (first, second) => {
        mocks.customers.mockResolvedValue([{ email: 'a@example.com', rawData: { contactStatus: first } }, { email: 'a@example.com', rawData: { contactStatus: second } }]);
        expect(await new MarketingAudienceService().exclusions('account', [{ id: 'member', email: 'a@example.com', isSubscribed: true }])).toEqual(['suppressed']);
    });
    it('counts duplicate addresses separately from eligible recipients', async () => {
        const service = new MarketingAudienceService();
        mocks.campaign.mockResolvedValue({ id: 'campaign', accountId: 'account' });
        vi.spyOn(service, 'batches').mockImplementation(async function* () { yield [{ id: '1', email: 'a@example.com' }, { id: '2', email: ' A@example.com ' }, { id: '3', email: null }]; });
        const result = await service.explain('account', 'campaign');
        expect(result).toMatchObject({ matched: 3, eligible: 1, complete: true, excluded: { duplicate: 1, missing_email: 1 } });
    });
    it('reports incomplete coverage rather than invented exact totals', async () => {
        const service = new MarketingAudienceService(); mocks.campaign.mockResolvedValue({ id: 'campaign', accountId: 'account' });
        vi.spyOn(service, 'batches').mockImplementation(async function* () { yield Array.from({ length: 10001 }, (_, index) => ({ id: String(index), email: `${index}@example.com` })); });
        expect(await service.explain('account', 'campaign')).toMatchObject({ matched: 0, eligible: 0, complete: false });
    });
});
