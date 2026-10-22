import { describe, expect, it } from 'vitest';
import { visibleFeedRows } from './feedRowGroups';

describe('visibleFeedRows', () => {
    const simple = { wooId: 1, rowType: 'parent', rowId: 'p:1' };
    const variants = [11, 12].map((id) => ({ wooId: 2, rowType: 'variation', rowId: `v:2-${id}` }));
    const group = { wooId: 2, rowType: 'group', rowId: 'g:2' };
    it('shows one collapsed parent editor instead of repeated variants', () => {
        expect(visibleFeedRows([simple, ...variants], [group], {})).toEqual([simple, group]);
    });
    it('expands children without losing their identities or order', () => {
        expect(visibleFeedRows([simple, ...variants], [group], { 2: true })).toEqual([simple, group, ...variants]);
    });
    it('leaves ungrouped modes unchanged', () => {
        expect(visibleFeedRows(variants, [], {})).toEqual(variants);
    });
});
