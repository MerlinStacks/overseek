import { describe, it, expect } from 'vitest';
import { buildContentLookupWhere } from '../contentHelpers';

describe('buildContentLookupWhere', () => {
    it('builds account-scoped OR lookup for numeric Woo ID', () => {
        expect(buildContentLookupWhere('12345', 'acct_1')).toEqual({
            accountId: 'acct_1',
            OR: [{ id: '12345' }, { wooId: 12345 }],
        });
    });

    it('builds account-scoped UUID lookup for non-numeric ID', () => {
        const id = '0f5ce436-fb3d-4067-8a8e-6ceff4f5d113';

        expect(buildContentLookupWhere(id, 'acct_2')).toEqual({
            id,
            accountId: 'acct_2',
        });
    });

    it('keeps account scoping for mixed IDs that are not pure numbers', () => {
        const id = '12345-legacy';

        expect(buildContentLookupWhere(id, 'acct_3')).toEqual({
            id,
            accountId: 'acct_3',
        });
    });
});
