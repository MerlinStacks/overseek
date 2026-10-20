import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: { id: 'a' }, fetch: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: { id: 'user' } }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
import { NotesSection } from './NotesSection';
const note = { id: 'note', content: 'Existing note', createdAt: 'invalid', createdBy: { id: 'user', fullName: 'Agent' } };
beforeEach(() => { vi.resetAllMocks(); mocks.account = { id: 'a' }; vi.stubGlobal('fetch', mocks.fetch); mocks.fetch.mockResolvedValue({ ok: true, json: async () => [note] }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('conversation note isolation', () => {
    it('keeps a note visible after an HTTP deletion failure', async () => {
        render(<NotesSection conversationId="conversation" />); await screen.findByText('Existing note');
        expect(screen.getByText(/Date unavailable/)).toBeInTheDocument();
        mocks.fetch.mockResolvedValueOnce({ ok: false });
        fireEvent.click(screen.getByRole('button', { name: 'Delete note: Existing note' })); fireEvent.click(screen.getByRole('button', { name: 'Delete note?' }));
        await screen.findByRole('alert'); expect(screen.getByText('Existing note')).toBeInTheDocument();
    });
    it('guards duplicate saves and IME composition and retains failed drafts', async () => {
        render(<NotesSection conversationId="conversation" />); await screen.findByText('Existing note');
        const input = screen.getByRole('textbox', { name: 'New conversation note' }); fireEvent.change(input, { target: { value: 'Draft' } });
        fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); fireEvent.keyDown(input, { key: 'Enter', repeat: true }); expect(mocks.fetch).toHaveBeenCalledOnce();
        let resolve!: (value: unknown) => void; mocks.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' }); expect(mocks.fetch).toHaveBeenCalledTimes(2);
        await act(async () => { resolve({ ok: false }); }); expect(screen.getByRole('alert')).toHaveTextContent('Could not save'); expect(input).toHaveValue('Draft');
    });
    it('aborts and ignores old-account reads and resets drafts on conversation changes', async () => {
        let resolve!: (value: unknown) => void; mocks.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const view = render(<NotesSection conversationId="first" />); await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce()); const signal = mocks.fetch.mock.calls[0][1].signal;
        mocks.account = { id: 'b' }; mocks.fetch.mockResolvedValue({ ok: true, json: async () => [{ ...note, content: 'New account note' }] }); view.rerender(<NotesSection conversationId="first" />);
        await screen.findByText('New account note'); await act(async () => { resolve({ ok: true, json: async () => [note] }); });
        expect(signal.aborted).toBe(true); expect(screen.queryByText('Existing note')).toBeNull();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private draft' } }); view.rerender(<NotesSection conversationId="second" />); expect(screen.getByRole('textbox')).toHaveValue('');
    });
    it('does not treat a failed load as an empty conversation', async () => {
        mocks.fetch.mockResolvedValue({ ok: false }); render(<NotesSection conversationId="conversation" />);
        await screen.findByRole('alert'); expect(screen.queryByText('No notes yet.')).toBeNull(); expect(screen.getByRole('button', { name: 'Retry notes' })).toBeInTheDocument();
    });
});
