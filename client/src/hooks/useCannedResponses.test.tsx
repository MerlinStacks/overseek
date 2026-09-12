import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCannedResponses } from './useCannedResponses';

let accountId = 'account-1';
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: { id: 'user-1' } }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: accountId } }) }));
const reply = (id: string) => ({ id, shortcut: id, content: id, labelId: null, label: null });
const response = (id: string) => ({ ok: true, json: async () => [reply(id)] }) as Response;

describe('useCannedResponses account isolation', () => {
    beforeEach(() => { accountId = 'account-1'; });
    afterEach(() => vi.unstubAllGlobals());

    it('hides previous-account replies immediately while the new account loads', async () => {
        let resolveNext!: (value: Response) => void;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response('old')).mockImplementationOnce(() => new Promise(resolve => { resolveNext = resolve; })));
        const { result, rerender } = renderHook(() => useCannedResponses());
        await waitFor(() => expect(result.current.cannedResponses[0]?.id).toBe('old'));
        accountId = 'account-2';
        rerender();
        expect(result.current.cannedResponses).toEqual([]);
        expect(result.current.cannedLoading).toBe(true);
        await act(async () => resolveNext(response('new')));
        expect(result.current.cannedResponses[0].id).toBe('new');
    });

    it('ignores a late previous-account request', async () => {
        let resolveOld!: (value: Response) => void;
        const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(response('new'));
        vi.stubGlobal('fetch', fetchMock);
        const { result, rerender } = renderHook(() => useCannedResponses());
        accountId = 'account-2';
        rerender();
        await waitFor(() => expect(result.current.cannedResponses[0]?.id).toBe('new'));
        await act(async () => resolveOld(response('old')));
        expect(result.current.cannedResponses[0].id).toBe('new');
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    });

    it('exposes a failed request and allows retrying', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response('recovered')));
        const { result } = renderHook(() => useCannedResponses());
        await waitFor(() => expect(result.current.cannedError).toBe(true));
        expect(result.current.cannedLoading).toBe(false);
        await act(async () => result.current.refetchCanned());
        expect(result.current.cannedError).toBe(false);
        expect(result.current.cannedResponses[0].id).toBe('recovered');
    });
});
