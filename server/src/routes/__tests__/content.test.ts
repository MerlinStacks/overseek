import { expect, it, vi } from 'vitest';
import { buildContentLookupWhere, findContentById } from '../contentHelpers';
it.each(['0', '01', '2147483648', '9999999999999999999999999', '-2', '1.5', 'bad id', ''])('rejects unsafe content identifier %s', id => { expect(() => buildContentLookupWhere(id, 'a')).toThrow(); });
it('resolves internal IDs before numeric Woo identifiers, always with trusted account', async () => {
    const find = vi.fn().mockResolvedValueOnce({ id: '123' }); expect(await findContentById('123', 'a', find)).toEqual({ id: '123' }); expect(find).toHaveBeenCalledOnce();
    find.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'internal' }); expect(await findContentById('123', 'a', find)).toEqual({ id: 'internal' }); expect(find.mock.calls).toEqual([[{ id: '123', accountId: 'a' }], [{ wooId: 123, accountId: 'a' }]]);
});
