import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ token: 'token', account: { id: 'a' }, request: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: m.token }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../services/api', () => ({ api: { request: m.request } }));
vi.mock('./MacrosDropdown', () => ({ MacrosDropdown: () => <span>Macros</span> }));
import { BulkActionToolbar } from './BulkActionToolbar';
import { ChatHeader } from './ChatHeader';
import { GravatarAvatar } from './GravatarAvatar';
import { OrdersSection } from './OrdersSection';
import { PreviousConversationsSection } from './PreviousConversationsSection';
import { RecipientList } from './RecipientList';
beforeEach(() => { vi.resetAllMocks(); m.token = 'token'; m.account = { id: 'a' }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('bulk selection isolation', () => {
    it('styles bulk actions distinctly and uses loaded names and subjects to choose the exact merge target', async () => {
        m.request.mockResolvedValue({ success: true, mergedCount: 1 });
        render(<BulkActionToolbar selectedIds={['a', 'b']} onClearSelection={vi.fn()} onActionComplete={vi.fn()} conversations={[
            { id: 'a', customer: 'Alex', subject: 'Order question', channel: 'EMAIL' },
            { id: 'b', customer: 'Alex', subject: 'Delivery question', channel: 'CHAT' },
        ]} />);
        expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('bg-indigo-600');
        expect(screen.getByRole('button', { name: 'Merge' })).toHaveClass('bg-red-50');
        expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
        const dialog = screen.getByRole('dialog');
        const target = within(dialog).getByRole('radio', { name: 'Alex · Delivery question · CHAT · Record ID: b' });
        fireEvent.click(target);
        expect(target).toBeChecked();
        expect(m.request).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Merge Conversations' }));
        await waitFor(() => expect(m.request).toHaveBeenCalledOnce());
        expect(JSON.parse(m.request.mock.calls[0][1].body)).toEqual({ targetId: 'b', sourceIds: ['a'] });
    });
    it('keeps missing conversation details honest and allows cancelling merge without a mutation', () => {
        render(<BulkActionToolbar selectedIds={['a', 'b']} onClearSelection={vi.fn()} onActionComplete={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
        expect(screen.getAllByText('Conversation details unavailable')).toHaveLength(2);
        expect(screen.getByText('Record ID: b')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel merge' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(m.request).not.toHaveBeenCalled();
    });
    it('serializes duplicate actions, reports failed confirmations and retains selections', async () => {
        let resolve!: (value: unknown) => void; m.request.mockReturnValue(new Promise(r => { resolve = r; })); const clear = vi.fn();
        render(<BulkActionToolbar selectedIds={['a', 'b']} onClearSelection={clear} onActionComplete={vi.fn()} />);
        const button = screen.getByRole('button', { name: 'Close' }); fireEvent.click(button); fireEvent.click(button); expect(m.request).toHaveBeenCalledOnce();
        await act(async () => { resolve({ success: false }); }); expect(screen.getByRole('alert')).toHaveTextContent('selection is retained'); expect(clear).not.toHaveBeenCalled();
    });
    it('aborts a previous selection and ignores its late callback', async () => {
        let resolve!: (value: unknown) => void; m.request.mockReturnValue(new Promise(r => { resolve = r; })); const clear = vi.fn(); const complete = vi.fn();
        const view = render(<BulkActionToolbar selectedIds={['a']} onClearSelection={clear} onActionComplete={complete} />); fireEvent.click(screen.getByRole('button', { name: 'Close' })); const signal = m.request.mock.calls[0][1].signal;
        view.rerender(<BulkActionToolbar selectedIds={['b']} onClearSelection={clear} onActionComplete={complete} />);
        await act(async () => { resolve({ success: true, updated: 1 }); }); expect(signal.aborted).toBe(true); expect(clear).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
    });
    it('does not clear partially updated selections or repeat saved work after a callback failure', async () => {
        m.request.mockResolvedValue({ success: true, updated: 1 }); const clear = vi.fn(); const complete = vi.fn().mockRejectedValue(new Error('Refresh failed'));
        render(<BulkActionToolbar selectedIds={['a', 'b']} onClearSelection={clear} onActionComplete={complete} />); fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        await screen.findByText(/Operation confirmed, but the list could not be refreshed/); expect(clear).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    });
    it('does not carry merge confirmation across accounts', () => {
        const props = { selectedIds: ['a', 'b'], onClearSelection: vi.fn(), onActionComplete: vi.fn() }; const view = render(<BulkActionToolbar {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Merge' })); expect(screen.getByRole('dialog')).toBeInTheDocument();
        m.account = { id: 'b' }; view.rerender(<BulkActionToolbar {...props} />); expect(screen.queryByRole('dialog')).toBeNull(); expect(m.request).not.toHaveBeenCalled();
    });
});
const header = { conversationId: 'a', recipientEmail: 'first@example.test', status: 'OPEN', isUpdatingStatus: false, showSearch: false, onToggleSearch: vi.fn(), onStatusChange: vi.fn(), onShowSnooze: vi.fn(), onShowAssign: vi.fn(), onShowMerge: vi.fn() };
describe('header confirmation and pending controls', () => {
    it('resets block confirmation on conversation changes', () => {
        const view = render(<ChatHeader {...header} onBlock={vi.fn()} />); fireEvent.click(screen.getByRole('button', { name: 'More options' })); fireEvent.click(screen.getByRole('button', { name: 'Block customer' })); expect(screen.getByRole('dialog')).toHaveTextContent('first@example.test');
        view.rerender(<ChatHeader {...header} conversationId="b" recipientEmail="second@example.test" onBlock={vi.fn()} />); expect(screen.queryByRole('dialog')).toBeNull();
    });
    it('serializes block calls and exposes rejection without dismissing confirmation', async () => {
        let reject!: (reason: Error) => void; const block = vi.fn(() => new Promise<void>((_, r) => { reject = r; })); render(<ChatHeader {...header} onBlock={block} />);
        fireEvent.click(screen.getByRole('button', { name: 'More options' })); fireEvent.click(screen.getByRole('button', { name: 'Block customer' })); const button = screen.getByRole('button', { name: 'Block' }); fireEvent.click(button); fireEvent.click(button); expect(block).toHaveBeenCalledOnce();
        await act(async () => { reject(new Error('Failed')); }); expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm blocking'); expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    it('disables pending-status actions when an update is in progress and provides menu expansion state', () => {
        const view = render(<ChatHeader {...header} />); fireEvent.click(screen.getByRole('button', { name: 'More status options' })); expect(screen.getByRole('button', { name: 'More status options' })).toHaveAttribute('aria-expanded', 'true');
        view.rerender(<ChatHeader {...header} isUpdatingStatus />); expect(screen.getByRole('button', { name: 'Mark as pending' })).toBeDisabled();
    });
});
describe('avatar identity', () => {
    it('immediately hides previous images and ignores stale digest results when email changes', async () => {
        let resolve!: (value: ArrayBuffer) => void; const digest = vi.fn().mockResolvedValueOnce(new Uint8Array(32).fill(1).buffer).mockReturnValueOnce(new Promise(r => { resolve = r; })); vi.stubGlobal('crypto', { subtle: { digest } });
        const view = render(<GravatarAvatar email="a@example.test" name="A" />); await waitFor(() => expect(view.container.querySelector('img')).not.toBeNull());
        view.rerender(<GravatarAvatar email="b@example.test" name="B" />); expect(view.container.querySelector('img')).toBeNull();
        view.rerender(<GravatarAvatar name="C" />); await act(async () => { resolve(new Uint8Array(32).fill(2).buffer); }); expect(view.container.querySelector('img')).toBeNull(); expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'C');
    });
    it('uses initials instead of inventing a non-Gravatar fallback hash', async () => {
        vi.stubGlobal('crypto', {}); const view = render(<GravatarAvatar email="a@example.test" name="A" />); expect(view.container.querySelector('img')).toBeNull(); expect(screen.getByText('A')).toBeInTheDocument();
    });
});
describe('safe contact history rendering', () => {
    it('preserves zero and strict numeric-string totals while handling unknown currencies and dates', () => {
        render(<MemoryRouter><OrdersSection isLoading={false} orders={[{ id: 'a', wooId: 1, number: '1', status: 'processing', total: '0' as unknown as number, currency: 'EUR', dateCreated: 'bad' }, { id: 'b', wooId: 2, number: '2', status: 'processing', total: 10, currency: '', dateCreated: 'bad' }]} /></MemoryRouter>);
        expect(screen.getAllByText('Date unavailable')).toHaveLength(2); expect(screen.getByText(/EUR.*0/)).toBeInTheDocument(); expect(screen.getByText('Unavailable')).toBeInTheDocument(); expect(screen.queryByText(/USD/)).toBeNull();
    });
    it('handles malformed preview content and dates and never submits an outer form', () => {
        const select = vi.fn(); render(<PreviousConversationsSection onSelectConversation={select} conversations={[{ id: 'a', status: 'OPEN', channel: 'EMAIL', updatedAt: 'bad', messages: [{ content: {} as string }] }]} />);
        expect(screen.getByText('Date unavailable')).toBeInTheDocument(); expect(screen.getByText('Message preview unavailable')).toBeInTheDocument(); const button = screen.getByRole('button'); expect(button).toHaveAttribute('type', 'button'); fireEvent.click(button); expect(select).toHaveBeenCalledExactlyOnceWith('a');
    });
    it('keeps equal names on distinct channels and unknown recipients with distinct identities', () => {
        const merged = [{ id: 'email', channel: 'EMAIL', guestEmail: 'a@test', guestName: 'Alice' }, { id: 'chat', channel: 'CHAT', guestEmail: 'a@test', guestName: 'Alice' }, { id: 'u1', channel: 'CHAT' }, { id: 'u2', channel: 'CHAT' }];
        const view = render(<RecipientList scopeKey="a" primaryEmail="a@test" primaryName="Alice" mergedRecipients={merged} />);
        fireEvent.click(screen.getByRole('button', { name: 'Show 3 additional recipients' })); expect(screen.getAllByText(/Unknown/)).toHaveLength(2); expect(screen.getAllByText('Alice').some(element => element.textContent === 'Alice (CHAT)')).toBe(true);
        view.rerender(<RecipientList scopeKey="b" primaryEmail="a@test" primaryName="Alice" mergedRecipients={merged} />); expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    });
});
