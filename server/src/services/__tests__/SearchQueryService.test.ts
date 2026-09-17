import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchQueryService } from '../search/SearchQueryService';

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../../utils/elastic', () => ({ esClient: { search } }));
vi.mock('../../utils/prisma', () => ({ prisma: {} }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));

describe('SearchQueryService.globalSearch', () => {
    beforeEach(() => {
        search.mockReset();
        search.mockResolvedValue({ hits: { hits: [] } });
    });

    it.each([
        ['  Ada.Lovelace@Example.COM  ', '*Ada.Lovelace@Example.COM*'],
        ['  Lovelace@EXAMPLE  ', '*Lovelace@EXAMPLE*'],
        ['a*b?c\\d@example.com', '*a\\*b\\?c\\\\d@example.com*'],
    ])('matches trimmed email substrings case-insensitively and literally: %j', async (query, pattern) => {
        await SearchQueryService.globalSearch('tenant-1', query);

        expect(search).toHaveBeenCalledTimes(3);
        const requests = search.mock.calls.map(([request]) => request);
        expect(requests.map(request => request.index)).toEqual(['products', 'customers', 'orders']);
        for (const request of requests) {
            expect(request.query.bool.must).toEqual([{ term: { accountId: 'tenant-1' } }]);
            expect(request.query.bool.minimum_should_match).toBe(1);
            expect(request.size).toBe(5);
        }
        expect(requests[1].query.bool.should).toEqual([
            { match: { firstName: query.trim() } },
            { match: { lastName: query.trim() } },
            { wildcard: { email: { value: pattern, case_insensitive: true } } }
        ]);
    });

    it.each(['', ' \t\n ', ' a '])('skips searches shorter than two trimmed characters: %j', async query => {
        expect(await SearchQueryService.globalSearch('tenant-1', query)).toEqual({
            products: [], customers: [], orders: []
        });
        expect(search).not.toHaveBeenCalled();
    });

    it('returns mixed-case customer source data from the email search', async () => {
        const customer = { accountId: 'tenant-1', email: 'Ada.Lovelace@Example.COM' };
        search.mockImplementation(async ({ index }) => ({
            hits: { hits: index === 'customers' ? [{ _source: customer }] : [] }
        }));

        expect(await SearchQueryService.globalSearch('tenant-1', ' lovelace@example ')).toEqual({
            products: [], customers: [customer], orders: []
        });
    });
});
