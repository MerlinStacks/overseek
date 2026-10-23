import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEmailDesignV2 } from '../../lib/emailDesignerV2';
import { EmailDesignEditorV2 } from './EmailDesignEditorV2';

const account = { id: 'account-1', name: 'Store', wooUrl: 'https://store.test' };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: { email: 'tester@example.com' } }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: account, refreshAccounts: vi.fn() }) }));
vi.mock('./emailDesignerV2/EmailDropCanvas', () => ({ EmailDropCanvas: () => <div>Canvas</div> }));
vi.mock('./emailDesignerV2/previewData', async (original) => ({
    ...await original<typeof import('./emailDesignerV2/previewData')>(),
    loadEmailPreviewData: vi.fn().mockResolvedValue(undefined),
}));

function initialDesign() {
    const design = createDefaultEmailDesignV2({ title: 'Saved subject', previewText: 'Keep my preview' });
    // No account-managed branding blocks, so simply opening must not save anything.
    design.document.sections = [{ id: 'section', columns: [{ id: 'column', width: 100, blocks: [{ id: 'message', type: 'text', props: { html: '<p>Saved message</p>' } }] }] }];
    return design;
}

beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/api/marketing/preview-email' ? {
        html: '<html><body>Prepared</body></html>', canonicalHtml: '<p>Prepared canonical content</p>', subject: 'Saved subject', previewText: 'Keep my preview', text: 'Prepared', hash: 'a'.repeat(64), rendererVersion: 'test-renderer', assets: [], missingTags: [], orderId: null, scenario: 'standard',
    } : url === '/api/marketing/preview-orders' ? { orders: [{ id: 'recent-order', number: '123', label: 'Recent customer' }] } : url === '/api/marketing/designer/sections' ? { presets: [] } : [] })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('email designer integration', () => {
    it('keeps section properties on the right and replaces Layouts with Layers on the left', () => {
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} onSave={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'layouts' })).not.toBeInTheDocument();
        expect(screen.queryByText(/Edit your layout here/)).not.toBeInTheDocument();
        const inspector = screen.getByRole('complementary', { name: 'Email properties' });
        expect(within(inspector).getByRole('tab', { name: 'section' })).toHaveAttribute('aria-selected', 'true');
        expect(within(inspector).getByText('Section settings')).toBeVisible();
        expect(within(inspector).getByRole('switch', { name: 'Responsive structure' })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'layers', exact: true }));
        expect(screen.getByRole('navigation', { name: 'Email layers' })).toBeVisible();
        expect(within(screen.getByRole('navigation', { name: 'Email layers' })).queryByText('Section settings')).not.toBeInTheDocument();
    });

    it('selects blocks from Layers without replacing the left panel and removes redundant visibility', async () => {
        const save = vi.fn();
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} onSave={save} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'layers', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Select Text: Saved message' }));
        const inspector = screen.getByRole('complementary', { name: 'Email properties' });
        expect(within(inspector).getByRole('tab', { name: 'block' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('navigation', { name: 'Email layers' })).toBeVisible();
        expect(within(inspector).queryByLabelText('Visibility')).not.toBeInTheDocument();
        expect(within(inspector).getByRole('switch', { name: 'Hide on mobile' })).toBeVisible();
        const responsive = within(inspector).getByRole('switch', { name: 'Responsive structure' });
        expect(responsive).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(responsive);
        expect(responsive).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(screen.getByRole('button', { name: 'Select section 1' }));
        expect(within(inspector).getByRole('tab', { name: 'section' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByText('Close', { exact: true }));
        await waitFor(() => expect(save).toHaveBeenCalledOnce());
        expect(save.mock.calls[0][1].document.sections[0].columns[0].blocks[0].responsive).toBe(false);
    });

    it('supports keyboard switching between inspector tabs', () => {
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} onSave={vi.fn()} onCancel={vi.fn()} />);
        const section = screen.getByRole('tab', { name: 'section' });
        fireEvent.keyDown(section, { key: 'ArrowRight' });
        const block = screen.getByRole('tab', { name: 'block' });
        expect(block).toHaveAttribute('aria-selected', 'true');
        expect(block).toHaveFocus();
        expect(screen.getByText('Select a block in the canvas or Layers panel to edit its properties.')).toBeVisible();
        fireEvent.keyDown(block, { key: 'Home' });
        expect(section).toHaveFocus();
        expect(section).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps warnings in a header checklist dropdown without replacing the builder sidebar', () => {
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} onSave={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.queryByText('Designer warnings')).not.toBeInTheDocument();
        const checklist = screen.getByText('Checklist', { exact: true });
        expect(checklist.closest('header')).toBeInTheDocument();
        expect(checklist.querySelector('[aria-label="Warnings"]')).toBeInTheDocument();
        fireEvent.click(checklist);
        expect(checklist.closest('details')).toHaveAttribute('open');
        expect(screen.getByText('Preflight checklist')).toBeVisible();
        expect(screen.getByPlaceholderText('Search blocks')).toBeVisible();
        fireEvent.keyDown(checklist, { key: 'Escape' });
        expect(checklist.closest('details')).not.toHaveAttribute('open');
        fireEvent.click(checklist);
        fireEvent.pointerDown(screen.getByText('Canvas'));
        expect(checklist.closest('details')).not.toHaveAttribute('open');
    });

    it('keeps the desktop HTML viewport wider than the mobile CSS breakpoint', async () => {
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} onSave={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delivery preview' }));
        expect((await screen.findByTitle('Prepared delivery HTML preview')).parentElement).toHaveStyle({ width: '920px' });
        expect(screen.getByLabelText('Delivery preview order').closest('header')).toBeInTheDocument();
        expect(screen.queryByLabelText('Delivery preview scenario')).not.toBeInTheDocument();
        expect(screen.queryByText(/HTML bytes|Missing values|Browser colour simulation/)).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Delivery preview order'), { target: { value: 'recent-order' } });
        await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, options]) => url === '/api/marketing/preview-email' && JSON.parse(options!.body as string).orderId === 'recent-order')).toBe(true));
        fireEvent.change(screen.getByLabelText('Preview device'), { target: { value: 'iphone-se' } });
        expect(screen.getByTitle('Prepared delivery HTML preview').parentElement).toHaveStyle({ width: '375px' });
    });

    it('preserves embedded preview text when no explicit override is provided', async () => {
        const save = vi.fn();
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} onSave={save} onCancel={vi.fn()} />);
        expect(screen.getByPlaceholderText('Add a Preview Text')).toHaveValue('Keep my preview');
        fireEvent.change(screen.getByPlaceholderText('Add a Subject Text'), { target: { value: 'Edited subject' } });
        fireEvent.click(screen.getByText('Close', { exact: true }));
        await waitFor(() => expect(save).toHaveBeenCalledOnce());
        expect(save.mock.calls[0][2]).toMatchObject({ subject: 'Edited subject', previewText: 'Keep my preview' });
        expect(save.mock.calls[0][0]).toContain('Keep my preview');
    });

    it('keeps the editor open after a failed close-save, then retries successfully', async () => {
        const save = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined);
        const close = vi.fn();
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} onSave={save} onCancel={close} />);
        fireEvent.change(screen.getByPlaceholderText('Add a Subject Text'), { target: { value: 'Do not lose this' } });
        fireEvent.click(screen.getByText('Close', { exact: true }));
        await screen.findByRole('alert');
        expect(close).not.toHaveBeenCalled();
        expect(screen.getByPlaceholderText('Add a Subject Text')).toHaveValue('Do not lose this');
        fireEvent.click(screen.getByText('Retry save'));
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
        fireEvent.click(screen.getByText('Close', { exact: true }));
        await waitFor(() => expect(close).toHaveBeenCalledOnce());
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('sends tests using the flow category and explicit preview text', async () => {
        const fetchMock = vi.mocked(fetch);
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} emailCategory="TRANSACTIONAL" previewOrderMode="none" onSave={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByText('Test', { exact: true }));
        fireEvent.click(screen.getByText('Send test', { exact: true }));
        await screen.findByTitle('Prepared delivery HTML preview');
        expect(fetchMock.mock.calls.some(([url]) => url === '/api/marketing/test-email')).toBe(false);
        fireEvent.click(screen.getByText('Send test', { exact: true }));
        await screen.findByText('Test email sent to tester@example.com.');
        const call = fetchMock.mock.calls.find(([url]) => url === '/api/marketing/test-email')!;
        expect(JSON.parse(call[1]!.body as string)).toMatchObject({ category: 'TRANSACTIONAL', previewText: 'Keep my preview', orderId: null, content: '<p>Prepared canonical content</p>' });
    });

    it('loads only history and reusable sections from this account AND email', async () => {
        const foreign = initialDesign();
        foreign.document.meta.title = 'Foreign email';
        const snapshot = [{ id: 'foreign', createdAt: '2026-10-18T00:00:00Z', design: foreign }];
        localStorage.setItem('overseek-email-builder-v2-history', JSON.stringify(snapshot));
        localStorage.setItem('overseek-email-builder-v2-history:account-2:campaign%3Aone', JSON.stringify(snapshot));
        localStorage.setItem('overseek-email-builder-v2-history:account-1:campaign%3Atwo', JSON.stringify(snapshot));
        localStorage.setItem('overseek-email-builder-v2-saved-sections:account-2:campaign%3Aone', JSON.stringify([{ id: 'foreign', name: 'Foreign section', section: foreign.document.sections[0] }]));
        const save = vi.fn();
        render(<EmailDesignEditorV2 storageScope="campaign:one" initialDesign={initialDesign()} onSave={save} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByText('History', { exact: true }));
        expect(screen.queryByText('Restore')).not.toBeInTheDocument();
        fireEvent.change(screen.getByPlaceholderText('Add a Subject Text'), { target: { value: 'Local edit' } });
        fireEvent.click(screen.getByText('Close', { exact: true }));
        await waitFor(() => expect(localStorage.getItem('overseek-email-builder-v2-history:account-1:campaign%3Aone')).toContain('Local edit'));
        expect(localStorage.getItem('overseek-email-builder-v2-history:account-1:campaign%3Atwo')).toContain('Foreign email');
    });

    it('requires confirmation for starter layouts and allows undoing the replacement', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} onSave={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByText('structure', { exact: true }));
        fireEvent.click(screen.getByText('Promo email', { exact: true }));
        expect(confirm).toHaveBeenCalledOnce();
        expect(screen.getByText('Undo', { exact: true })).toBeDisabled();
        fireEvent.click(screen.getByText('Promo email', { exact: true }));
        expect(screen.getByText('Undo', { exact: true })).not.toBeDisabled();
        await act(async () => { fireEvent.click(screen.getByText('Undo', { exact: true })); });
        expect(screen.getByText('Redo', { exact: true })).not.toBeDisabled();
    });
});
