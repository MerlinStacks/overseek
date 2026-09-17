import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomersService } from '../customers';

const mocks = vi.hoisted(() => ({ suppressions: vi.fn(), search: vi.fn() }));
vi.mock('../../utils/prisma', () => ({
    prisma: { emailUnsubscribe: { findMany: mocks.suppressions } }
}));
vi.mock('../../utils/elastic', () => ({ esClient: { search: mocks.search } }));
vi.mock('../../utils/logger', () => ({ Logger: { debug: vi.fn(), error: vi.fn() } }));
vi.mock('../woo', () => ({ WooService: {} }));
vi.mock('../search/IndexingService', () => ({ IndexingService: {} }));
vi.mock('../automation/ContactAutomationHistory', () => ({ getContactAutomationHistory: vi.fn() }));

describe('CustomersService legacy ES search suppression statuses', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.suppressions.mockResolvedValue([]);
        mocks.search.mockResolvedValue({
            hits: { hits: [], total: { value: 0 } },
            aggregations: { contact_statuses: { buckets: [] } }
        });
    });

    const cases = [
        ['ALL', null, 'SUBSCRIBED', 'UNSUBSCRIBED'],
        ['ALL', null, undefined, 'UNSUBSCRIBED'],
        ['ALL', null, 'COMPLAINT', 'COMPLAINT'],
        ['ALL', null, 'BOUNCED', 'BOUNCED'],
        ['ALL', null, 'SOFT_BOUNCED', 'SOFT_BOUNCED'],
        ['MARKETING', null, 'SUBSCRIBED', 'UNSUBSCRIBED'],
        ['MARKETING', null, 'COMPLAINT', 'COMPLAINT'],
        ['MARKETING', null, 'BOUNCED', 'BOUNCED'],
        ['MARKETING', null, 'SOFT_BOUNCED', 'SOFT_BOUNCED'],
        ['ALL', 'UNSUBSCRIBED', 'COMPLAINT', 'UNSUBSCRIBED'],
        ['ALL', 'BOUNCED', 'COMPLAINT', 'BOUNCED'],
        ['ALL', 'COMPLAINT', 'BOUNCED', 'COMPLAINT'],
        ['MARKETING', 'SOFT_BOUNCED', 'SUBSCRIBED', 'SOFT_BOUNCED'],
        ['MARKETING', 'COMPLAINT', 'SUBSCRIBED', 'COMPLAINT'],
        ['TRANSACTIONAL', 'COMPLAINT', 'SUBSCRIBED', 'SUBSCRIBED'],
        [undefined, undefined, ' bounced ', 'BOUNCED'],
        [undefined, undefined, 'invalid', 'UNVERIFIED'],
        [undefined, undefined, undefined, 'UNVERIFIED']
    ] as const;

    it.each(cases)('resolves scope=%s explicit=%s raw=%s to %s in labels and ES groups', async (scope, explicit, raw, expected) => {
        if (scope) {
            mocks.suppressions.mockResolvedValue([{ email: ' Person@Example.com ', scope, contactStatus: explicit }]);
        }
        mocks.search.mockResolvedValueOnce({
            hits: { hits: [{ _id: '42', _source: { email: 'PERSON@example.com', rawData: { contactStatus: raw } } }], total: { value: 1 } }
        });

        const result = await CustomersService.searchCustomers('account');
        expect(result.customers[0].contactStatus).toBe(expected);
        const params = mocks.search.mock.calls[0][0].runtime_mappings.effective_contact_status.script.params;
        const group = params.emailGroups['person@example.com'];
        if (scope === 'ALL' || scope === 'MARKETING') {
            expect(params.statusGroups[group][raw || 'UNVERIFIED']).toBe(expected);
        } else {
            expect(group).toBeUndefined();
        }
        expect(params.fallback).toBe('UNVERIFIED');
    });

    it.each(['UNVERIFIED', 'SUBSCRIBED', 'BOUNCED', 'UNSUBSCRIBED', 'SOFT_BOUNCED', 'COMPLAINT'] as const)(
        'filters %s and aggregates the same effective ES field', async (status) => {
            const result = await CustomersService.searchCustomers('account', 'Alice', 2, 5, status);
            const [search, counts] = mocks.search.mock.calls.map(([request]) => request);
            expect(search.query.bool.must).toEqual(expect.arrayContaining([
                { term: { accountId: 'account' } },
                { range: { ordersCount: { gt: 0 } } },
                { multi_match: { query: 'Alice', fields: ['firstName', 'lastName', 'email'], fuzziness: 'AUTO' } },
                { term: { effective_contact_status: status } }
            ]));
            expect(search).toMatchObject({ from: 5, size: 5, track_total_hits: true });
            expect(counts.runtime_mappings).toEqual(search.runtime_mappings);
            expect(counts.aggs.contact_statuses.terms).toEqual({ field: 'effective_contact_status', size: 6 });
            expect(counts.query.bool.must).not.toContainEqual({ term: { effective_contact_status: status } });
            expect(result.page).toBe(2);
            expect(mocks.suppressions).toHaveBeenCalledWith(expect.objectContaining({
                where: { accountId: 'account', scope: { in: ['MARKETING', 'ALL'] } },
                select: { email: true, scope: true, contactStatus: true }
            }));
        }
    );

    it('returns effective counts directly without reclassifying ALL suppressions as complaints', async () => {
        mocks.suppressions.mockResolvedValue([{ email: 'generic@example.com', scope: 'ALL', contactStatus: null }]);
        mocks.search.mockResolvedValueOnce({ hits: { hits: [], total: { value: 3 } } });
        mocks.search.mockResolvedValueOnce({
            hits: { hits: [], total: { value: 12 } },
            aggregations: { contact_statuses: { buckets: [
                { key: 'UNVERIFIED', doc_count: 2 },
                { key: 'SUBSCRIBED', doc_count: 1 },
                { key: 'UNSUBSCRIBED', doc_count: 3 },
                { key: 'BOUNCED', doc_count: 4 },
                { key: 'SOFT_BOUNCED', doc_count: 1 },
                { key: 'COMPLAINT', doc_count: 1 }
            ] } }
        });
        const result = await CustomersService.searchCustomers('account', '', 1, 2, 'UNSUBSCRIBED');
        expect(result).toMatchObject({ total: 3, totalPages: 2, statusCounts: {
            ALL: 12, UNVERIFIED: 2, SUBSCRIBED: 1, UNSUBSCRIBED: 3,
            BOUNCED: 4, SOFT_BOUNCED: 1, COMPLAINT: 1
        } });
    });

    it('keeps advanced filters on the unsubscribe search', async () => {
        await CustomersService.searchCustomers('account', '', 1, 20, 'UNSUBSCRIBED', [
            { combinator: 'AND', conditions: [{ field: 'Name', operator: 'is', value: 'Alice' }] }
        ]);
        expect(mocks.search.mock.calls[0][0].query.bool.must).toHaveLength(4);
    });

    it.each(['is', 'is not'])('uses effective status for advanced Contact Status %s filters', async (operator) => {
        await CustomersService.searchCustomers('account', '', 1, 20, 'ALL', [
            { combinator: 'AND', conditions: [{ field: 'Contact Status', operator, value: ' unsubscribed ' }] }
        ]);
        const clause = { term: { effective_contact_status: 'UNSUBSCRIBED' } };
        expect(mocks.search.mock.calls[0][0].query.bool.must[2]).toEqual({
            bool: { must: [operator === 'is not' ? { bool: { must_not: [clause] } } : clause] }
        });
    });

    it('returns the existing empty result on ES failure', async () => {
        mocks.search.mockRejectedValue(new Error('ES unavailable'));
        expect(await CustomersService.searchCustomers('account')).toMatchObject({
            customers: [], total: 0, totalPages: 0, statusCounts: { ALL: 0, COMPLAINT: 0, UNSUBSCRIBED: 0 }
        });
    });
});
