import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxAttachmentFilename, resolveInboxAttachmentHtml, useInboxAttachments } from './useInboxAttachments';
import { MessageBubble } from '../components/chat/MessageBubble';

const m = vi.hoisted(() => ({ token: 'session-a', accountId: 'account-a', fetch: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: m.token, user: { fullName: 'Agent' } }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: m.accountId } }) }));
vi.mock('../components/chat/GravatarAvatar', () => ({ GravatarAvatar: () => null }));

beforeEach(() => {
    vi.clearAllMocks();
    m.token = 'session-a'; m.accountId = 'account-a';
    vi.stubGlobal('fetch', m.fetch);
    vi.stubGlobal('URL', class extends URL {
        static createObjectURL = m.create;
        static revokeObjectURL = m.revoke;
    });
    m.create.mockReturnValue('blob:private-photo');
    m.fetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['jpeg bytes'], { type: 'image/jpeg' }) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('authenticated inbox images', () => {
    const photo = '/uploads/attachments/1000023950.jpg';
    const renderMessage = (content: string) => render(<MessageBubble message={{ id: 'message-a', content, senderType: 'CUSTOMER', createdAt: '2026-10-24T00:00:00Z', isInternal: false }} />);

    it('loads the inline photo using authentication and an account/message-scoped API, never the public URL', async () => {
        renderMessage(`<div>Please see photos attached<br><img alt="Customer photo" src="${photo}"></div>`);
        expect(screen.getByRole('img', { name: 'Customer photo' })).not.toHaveAttribute('src');
        await waitFor(() => expect(screen.getByRole('img', { name: 'Customer photo' })).toHaveAttribute('src', 'blob:private-photo'));
        expect(m.fetch).toHaveBeenCalledOnce();
        expect(m.fetch).toHaveBeenCalledWith('/api/chat/messages/message-a/attachments/1000023950.jpg', expect.objectContaining({ headers: { Authorization: 'Bearer session-a', 'X-Account-ID': 'account-a' } }));
        cleanup();
        expect(m.revoke).toHaveBeenCalledWith('blob:private-photo');
    });

    it('keeps inline downloads available, uses the authenticated blob and deduplicates the read', async () => {
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        renderMessage(`<img alt="Customer photo" src="${photo}">`);
        await waitFor(() => expect(screen.getByRole('img', { name: 'Customer photo' })).toHaveAttribute('src', 'blob:private-photo'));
        fireEvent.click(screen.getByRole('link', { name: '1000023950.jpg' }));
        await waitFor(() => expect(click).toHaveBeenCalledOnce());
        expect(click.mock.instances[0]).toHaveAttribute('href', 'blob:private-photo');
        expect(click.mock.instances[0]).toHaveAttribute('download', '1000023950.jpg');
        expect(m.fetch).toHaveBeenCalledOnce();
        click.mockRestore();
    });

    it('downloads non-image files on demand instead of fetching every attachment up front', async () => {
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        renderMessage('[proof.pdf](/uploads/attachments/proof.pdf)');
        expect(m.fetch).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('link', { name: 'proof.pdf' }));
        await waitFor(() => expect(click).toHaveBeenCalledOnce());
        expect(m.fetch.mock.calls[0][0]).toBe('/api/chat/messages/message-a/attachments/proof.pdf');
        click.mockRestore();
    });

    it('shows read failures without falling back to unauthenticated requests, and permits a deliberate retry', async () => {
        m.fetch.mockResolvedValueOnce({ ok: false });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        renderMessage(`<img alt="Customer photo" src="${photo}">`);
        expect(await screen.findByRole('alert')).toHaveTextContent('Attachment unavailable');
        expect(screen.getByRole('img', { name: 'Customer photo' })).not.toHaveAttribute('src');
        fireEvent.click(screen.getByRole('link', { name: '1000023950.jpg' }));
        await waitFor(() => expect(click).toHaveBeenCalledOnce());
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(m.fetch).toHaveBeenCalledTimes(2);
        click.mockRestore();
    });

    it('does not send credentials to remote email images or allow arbitrary blob URLs through the sanitizer', async () => {
        const { container } = renderMessage('<img alt="Remote" src="https://external.example/photo.jpg"><img alt="Untrusted" src="blob:attacker">');
        expect(screen.getByRole('img', { name: 'Remote' })).toHaveAttribute('src', 'https://external.example/photo.jpg');
        expect(container.querySelector('img[alt="Untrusted"]')).not.toHaveAttribute('src');
        expect(m.fetch).not.toHaveBeenCalled();
    });

    it('does not publish an old account read completing after an account switch', async () => {
        let finish!: (value: unknown) => void;
        m.fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const { result, rerender } = renderHook(() => useInboxAttachments('message-a', [photo]));
        const oldSignal = m.fetch.mock.calls[0][1].signal;
        m.accountId = 'account-b';
        rerender();
        expect(oldSignal.aborted).toBe(true);
        await waitFor(() => expect(result.current.urls[photo]).toBe('blob:private-photo'));
        await act(async () => { finish({ ok: true, blob: async () => new Blob(['old account']) }); });
        expect(m.create).toHaveBeenCalledOnce();
        expect(m.fetch.mock.calls[1][1].headers['X-Account-ID']).toBe('account-b');
    });

    it('works through StrictMode effect cleanup/replay', async () => {
        const { result } = renderHook(() => useInboxAttachments('message-a', [photo]), { wrapper: StrictMode });
        await waitFor(() => expect(result.current.urls[photo]).toBe('blob:private-photo'));
        expect(m.create).toHaveBeenCalledOnce();
    });

    it('recognizes only local single-segment paths and preserves legacy filenames', () => {
        expect(inboxAttachmentFilename('/uploads/attachments/100%25%20artwork%20%281%29.svg')).toBe('100% artwork (1).svg');
        expect(inboxAttachmentFilename('/uploads/attachments/100% artwork (1).svg')).toBe('100% artwork (1).svg');
        for (const value of ['https://external.example/uploads/attachments/photo.jpg', '/uploads/attachments/..%2Fsecret', '/uploads/attachments/a%5Cb.jpg', 'javascript:alert(1)']) expect(inboxAttachmentFilename(value)).toBeNull();
    });

    it('rewrites only sanitized attachment attributes, not body text or remote URLs', () => {
        const html = resolveInboxAttachmentHtml(`<p>${photo}</p><img src="${photo}"><a href="${photo}">Photo</a><img src="https://external.example/photo.jpg">`, { [photo]: 'blob:ours' });
        expect(html).toContain(`<p>${photo}</p>`);
        expect(html).toContain('src="blob:ours"');
        expect(html).toContain('href="blob:ours"');
        expect(html).toContain('src="https://external.example/photo.jpg"');
    });
});
