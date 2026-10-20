import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: { id: 'a' } as { id: string } | null, token: 'token', fetch: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: mocks.token }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
import { useEmailAccounts } from './useEmailAccounts';
const accounts = [{ id: 'first', name: 'First', email: 'first@test.com' }, { id: 'default', name: 'Default', email: 'default@test.com', isDefault: true }];
beforeEach(() => { vi.resetAllMocks(); mocks.account = { id: 'a' }; mocks.token = 'token'; vi.stubGlobal('fetch', mocks.fetch); mocks.fetch.mockResolvedValue({ ok: true, json: async () => accounts }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('email sender scope', () => {
    it('selects the default and permits only loaded sender IDs', async () => {
        const { result } = renderHook(useEmailAccounts);
        await waitFor(() => expect(result.current.selectedEmailAccountId).toBe('default'));
        act(() => result.current.setSelectedEmailAccountId('first'));
        expect(result.current.selectedEmailAccountId).toBe('first');
        act(() => result.current.setSelectedEmailAccountId('foreign'));
        expect(result.current.selectedEmailAccountId).toBe('first');
    });
    it('immediately hides old senders, aborts stale requests and ignores late responses', async () => {
        let resolve!: (value: unknown) => void;
        const { result, rerender } = renderHook(useEmailAccounts);
        await waitFor(() => expect(result.current.emailAccounts).toHaveLength(2));
        mocks.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        mocks.account = { id: 'b' }; rerender();
        expect(result.current.emailAccounts).toEqual([]); expect(result.current.selectedEmailAccountId).toBe('');
        const signal = mocks.fetch.mock.calls[1][1].signal;
        mocks.account = { id: 'c' }; mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => [] }); rerender();
        expect(signal.aborted).toBe(true);
        await act(async () => { resolve({ ok: true, json: async () => accounts }); });
        expect(result.current.emailAccounts).toEqual([]); expect(result.current.selectedEmailAccountId).toBe('');
    });
    it.each([[], { unexpected: true }])('leaves no stale selection for an empty/invalid result: %j', async data => {
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => data });
        const { result } = renderHook(useEmailAccounts);
        await act(async () => {});
        expect(result.current.emailAccounts).toEqual([]); expect(result.current.selectedEmailAccountId).toBe('');
    });
    it('hides senders on logout and clears them after an HTTP failure', async () => {
        const { result, rerender } = renderHook(useEmailAccounts);
        await waitFor(() => expect(result.current.emailAccounts).toHaveLength(2));
        mocks.token = ''; rerender(); expect(result.current.emailAccounts).toEqual([]);
        mocks.fetch.mockResolvedValue({ ok: false }); mocks.token = 'other-token'; rerender();
        await act(async () => {});
        expect(result.current.selectedEmailAccountId).toBe('');
    });
});
