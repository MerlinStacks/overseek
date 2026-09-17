import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewsPage } from './ReviewsPage';

const mocks = vi.hoisted(() => ({
    account: { id: 'account-1' },
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => mocks.toast }));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => false }) }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn() } }));

const suggestions = ['So glad the engraving turned out well!', 'Thanks, Sam. It is lovely to hear you enjoyed your gift.', 'The engraved detail makes this one special. Thank you for sharing your experience.'];
const fetchMock = vi.fn();
let generate: () => Promise<Response>;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
    vi.clearAllMocks();
    mocks.account = { id: 'account-1' };
    generate = async () => json({ replies: suggestions });
    fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/ai-reply')) return generate();
        if (url.endsWith('/reply')) return json({ success: true });
        return json({ reviews: [{ id: 'review-1', reviewer: 'Sam', productName: 'Engraved gift', content: 'Beautiful engraving', rating: 5, status: 'approved', dateCreated: '2026-09-01T00:00:00Z' }], pagination: { pages: 1 } });
    });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openReply() {
    const view = render(<MemoryRouter><ReviewsPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }));
    return view;
}

describe('Review reply picker', () => {
    it('offers three replies, allows editing, and posts only on explicit confirmation', async () => {
        await openReply();
        fireEvent.click(screen.getByRole('button', { name: 'Generate 3 replies' }));
        await screen.findByRole('button', { name: /Option 3/ });
        expect(screen.getByLabelText('Your reply')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Post reply' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: /Option 2/ }));
        expect(screen.getByLabelText('Your reply')).toHaveValue(suggestions[1]);
        fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'My edited reply' } });
        expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/reply'))).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', { name: 'Post reply' }));
        await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Reply posted'));
        expect(fetchMock).toHaveBeenCalledWith('/api/reviews/review-1/reply', expect.objectContaining({ body: JSON.stringify({ reply: 'My edited reply' }) }));
    });

    it('supports manual posting without making an AI request', async () => {
        await openReply();
        fireEvent.click(screen.getByRole('button', { name: 'Write my own' }));
        fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'A handmade response' } });
        fireEvent.click(screen.getByRole('button', { name: 'Post reply' }));
        await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Reply posted'));
        expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/ai-reply'))).toBe(false);
    });

    it('preserves manual text during generation and restores it after choosing an AI option', async () => {
        await openReply();
        fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'My own draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Generate 3 replies' }));
        fireEvent.click(await screen.findByRole('button', { name: /Option 1/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Write my own' }));
        expect(screen.getByLabelText('Your reply')).toHaveValue('My own draft');
    });

    it('regenerates without overwriting edits made while waiting and sends previous options', async () => {
        await openReply();
        fireEvent.click(screen.getByRole('button', { name: 'Generate 3 replies' }));
        fireEvent.click(await screen.findByRole('button', { name: /Option 1/ }));
        let resolve!: (response: Response) => void;
        generate = () => new Promise((done) => { resolve = done; });
        fireEvent.click(screen.getByRole('button', { name: 'Generate new options' }));
        fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Edited while waiting' } });
        await act(async () => resolve(json({ replies: ['New reply one', 'New reply two', 'New reply three'] })));
        expect(screen.getByLabelText('Your reply')).toHaveValue('Edited while waiting');
        expect(screen.getByRole('button', { name: /Option 1/ })).toHaveTextContent('New reply one');
        expect(fetchMock).toHaveBeenCalledWith('/api/reviews/review-1/ai-reply', expect.objectContaining({
            body: JSON.stringify({ currentDraft: suggestions[0], previousReplies: suggestions }),
            headers: expect.objectContaining({ 'X-Account-ID': 'account-1', Authorization: 'Bearer token' }),
        }));
    });

    it.each([json({ error: 'AI is not configured' }, 400), json({ replies: ['Only one'] })])('keeps drafts usable when generation fails', async (response) => {
        await openReply();
        generate = async () => response;
        fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Keep my draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Generate 3 replies' }));
        await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
        expect(screen.getByLabelText('Your reply')).toHaveValue('Keep my draft');
        expect(screen.getByRole('button', { name: 'Post reply' })).toBeEnabled();
    });

    it('clears suggestions when reopening the modal', async () => {
        await openReply();
        fireEvent.click(screen.getByRole('button', { name: 'Generate 3 replies' }));
        await screen.findByRole('button', { name: /Option 1/ });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
        expect(screen.queryByRole('button', { name: /Option 1/ })).not.toBeInTheDocument();
        expect(screen.getByLabelText('Your reply')).toHaveValue('');
    });

    it('ignores a pending generation after switching accounts', async () => {
        const view = await openReply();
        let resolve!: (response: Response) => void;
        generate = () => new Promise((done) => { resolve = done; });
        fireEvent.click(screen.getByRole('button', { name: 'Generate 3 replies' }));
        mocks.account = { id: 'account-2' };
        view.rerender(<MemoryRouter><ReviewsPage /></MemoryRouter>);
        await act(async () => resolve(json({ replies: suggestions })));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mocks.toast.success).not.toHaveBeenCalled();
    });
});
