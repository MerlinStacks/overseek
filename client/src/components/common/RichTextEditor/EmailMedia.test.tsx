import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from './RichTextEditor';
import { compileEmailDesignV2, createDefaultEmailDesignV2 } from '../../../lib/emailDesignerV2';

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'a', appearance: {} } }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('email footer media', () => {
    const features = ['bold', 'link', 'image', 'social'] as const;
    it('inserts an image and retains it and unsubscribe on reload', async () => {
        const change = vi.fn();
        const { unmount } = render(<RichTextEditor features={[...features]} value={'<p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>'} onChange={change} />);
        await screen.findByText('Unsubscribe');
        fireEvent.click(screen.getByRole('button', { name: 'Add image' }));
        fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: 'https://store.test/logo.png' } });
        fireEvent.change(screen.getByLabelText('Alternative text'), { target: { value: 'Store logo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
        await waitFor(() => expect(screen.getByAltText('Store logo')).toBeInTheDocument());
        await waitFor(() => expect(change).toHaveBeenCalled());
        const html = change.mock.lastCall![0];
        expect(html).toContain('https://store.test/logo.png');
        expect(html).toContain('{{unsubscribe_url}}');
        expect(html).not.toContain('https://{{unsubscribe_url}}');
        expect(html).not.toContain('Remove image');
        unmount();
        render(<RichTextEditor features={[...features]} value={html} onChange={vi.fn()} />);
        await waitFor(() => expect(screen.getByAltText('Store logo')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Remove image: Store logo' }));
        await waitFor(() => expect(screen.queryByAltText('Store logo')).not.toBeInTheDocument());
    });
    it('inserts social icons as linked, reloadable images', async () => {
        const change = vi.fn();
        render(<RichTextEditor features={[...features]} value="<p>Footer</p>" onChange={change} />);
        await screen.findByText('Footer');
        fireEvent.click(screen.getByRole('button', { name: 'Add social links' }));
        fireEvent.change(screen.getByLabelText('Social URL 1'), { target: { value: 'https://facebook.com/store' } });
        fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
        await waitFor(() => expect(screen.getByAltText('Facebook')).toBeInTheDocument());
        await waitFor(() => expect(change.mock.lastCall?.[0]).toContain('https://facebook.com/store'));
        expect(screen.getByAltText('Facebook').closest('a')).toHaveAttribute('href', 'https://facebook.com/store');
    });
    it('rejects unsafe image URLs and cancels without changing content', async () => {
        const change = vi.fn();
        render(<RichTextEditor features={[...features]} value="<p>Footer</p>" onChange={change} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add image' }));
        fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: 'javascript:alert(1)' } });
        fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
        expect(screen.getByRole('alert')).toHaveTextContent('HTTPS');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    it('uploads to the same scoped email asset endpoint as the designer', async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://store.test/upload.png' }) });
        vi.stubGlobal('fetch', fetch);
        render(<RichTextEditor features={[...features]} value="<p>Footer</p>" onChange={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add image' }));
        fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [new File(['png'], 'logo.png', { type: 'image/png' })] } });
        await waitFor(() => expect(screen.getByLabelText('Image URL')).toHaveValue('https://store.test/upload.png'));
        expect(fetch).toHaveBeenCalledWith('/api/marketing/designer/assets', expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer token', 'X-Account-ID': 'a' } }));
    });
    it('retains images in compiled footers but still strips active content', () => {
        const design = createDefaultEmailDesignV2();
        design.document.sections[0].columns[0].blocks = [{ id: 'footer', type: 'footer', props: { html: '<p><a href="{{unsubscribe_url}}">Unsubscribe</a><img src="https://store.test/logo.png" width="100" alt="Logo" onerror="alert(1)"><script>alert(1)</script></p>' } }];
        const html = compileEmailDesignV2(design);
        expect(html).toContain('https://store.test/logo.png');
        expect(html).toContain('{{unsubscribe_url}}');
        expect(html).not.toContain('onerror');
        expect(html).not.toContain('<script');
    });
});
