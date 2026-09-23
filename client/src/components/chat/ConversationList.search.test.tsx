import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationList } from './ConversationList';
import type { Conversation } from './ConversationItem';

let currentAccount = { id: 'account-1' };
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../hooks/useDrafts', () => ({ useDrafts: () => ({ hasDraft: () => false }) }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn() } }));
vi.mock('./BulkActionToolbar', () => ({ BulkActionToolbar: () => null }));
vi.mock('./ConversationItem', () => ({
    ConversationItem: ({ conv, onSelect }: { conv: Conversation; onSelect: (id: string) => void }) =>
        <button onClick={() => onSelect(conv.id)}>{conv.guestName}</button>,
}));
vi.mock('react-virtuoso', () => ({
    Virtuoso: ({ data, itemContent }: { data: Conversation[]; itemContent: (index: number, conversation: Conversation) => ReactNode }) =>
        <div data-testid="conversation-list">{data.map((conversation, index) => itemContent(index, conversation))}</div>,
}));

function response(results: unknown[] = [], ok = true) {
    return { ok, status: ok ? 200 : 503, json: async () => ({ results }) } as Response;
}
const match = { id: 'match-1', guestName: 'Alice', messages: [], updatedAt: '2026-09-21T00:00:00Z' };
function deferred() {
    let resolve!: (value: Response) => void;
    const promise = new Promise<Response>(done => { resolve = done; });
    return { promise, resolve };
}
async function debounce() {
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}
function search(value: string) {
    fireEvent.change(screen.getByPlaceholderText('Search, attachment:invoice, file:pdf...'), { target: { value } });
}

describe('inbox search refresh', () => {
    const searchFetch = vi.fn<typeof fetch>();
    const props = { conversations: [], selectedId: null, onSelect: vi.fn() };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        currentAccount = { id: 'account-1' };
        searchFetch.mockReset().mockResolvedValue(response([match]));
        vi.stubGlobal('fetch', vi.fn<typeof fetch>((input, init) =>
            String(input) === '/api/labels' ? Promise.resolve(response()) : searchFetch(input, init)));
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('keeps the list mounted and selectable throughout a background refresh', async () => {
        const { rerender } = render(<ConversationList {...props} />);
        search('Alice');
        await debounce();
        const list = screen.getByTestId('conversation-list');
        const pending = deferred();
        searchFetch.mockReturnValueOnce(pending.promise);
        rerender(<ConversationList {...props} refreshRevision={1} />);
        expect(screen.getByTestId('conversation-list')).toBe(list);
        await debounce();
        fireEvent.click(screen.getByText('Alice'));
        expect(props.onSelect).toHaveBeenCalledWith('match-1');
        await act(async () => { pending.resolve(response([match])); });
        expect(screen.getByTestId('conversation-list')).toBe(list);
    });

    it.each(['http', 'network'])('preserves matches on a failed %s refresh', async (failure) => {
        const { rerender } = render(<ConversationList {...props} />);
        search('Alice');
        await debounce();
        if (failure === 'http') searchFetch.mockResolvedValueOnce(response([], false));
        else searchFetch.mockRejectedValueOnce(new Error('Offline'));
        rerender(<ConversationList {...props} refreshRevision={1} />);
        await debounce();
        expect(screen.getByText('Alice')).toBeTruthy();
        expect(screen.getByRole('status').textContent).toContain('Search could not be updated');
    });

    it('ignores an obsolete response during the next query debounce', async () => {
        const pending = deferred();
        searchFetch.mockReturnValueOnce(pending.promise);
        render(<ConversationList {...props} />);
        search('Alice');
        await debounce();
        search('Bob');
        await act(async () => { pending.resolve(response([match])); });
        expect(screen.queryByText('Alice')).toBeNull();
        expect(screen.queryByText('No conversations found')).toBeNull();
        searchFetch.mockResolvedValueOnce(response([{ ...match, id: 'match-2', guestName: 'Bob' }]));
        await debounce();
        expect(screen.getByText('Bob')).toBeTruthy();
    });

    it('clears old results on account changes but not equivalent account objects', async () => {
        const { rerender } = render(<ConversationList {...props} />);
        search('Alice');
        await debounce();
        currentAccount = { id: 'account-1' };
        rerender(<ConversationList {...props} />);
        await debounce();
        expect(searchFetch).toHaveBeenCalledTimes(1);
        currentAccount = { id: 'account-2' };
        rerender(<ConversationList {...props} />);
        expect(screen.queryByText('Alice')).toBeNull();
    });

    it('removes matches when a refresh successfully returns no results', async () => {
        const { rerender } = render(<ConversationList {...props} />);
        search('Alice');
        await debounce();
        searchFetch.mockResolvedValueOnce(response());
        rerender(<ConversationList {...props} refreshRevision={1} />);
        await debounce();
        expect(screen.queryByText('Alice')).toBeNull();
        expect(screen.getByText('No conversations found')).toBeTruthy();
    });
});
