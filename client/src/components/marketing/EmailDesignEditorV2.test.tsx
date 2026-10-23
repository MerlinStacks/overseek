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
    it('clones blocks from Layers with fresh IDs and supports undo and redo', async () => {
        const save = vi.fn();
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} onSave={save} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'layers', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Clone Text: Saved message' }));
        expect(screen.getAllByRole('button', { name: 'Select Text: Saved message' })).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: 'Select Text: Saved message' })[1]).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
        expect(screen.getAllByRole('button', { name: 'Select Text: Saved message' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Redo', exact: true }));
        expect(screen.getAllByRole('button', { name: 'Select Text: Saved message' })).toHaveLength(2);
        fireEvent.click(screen.getByText('Close', { exact: true }));
        await waitFor(() => expect(save).toHaveBeenCalledOnce());
        const blocks = save.mock.calls[0][1].document.sections[0].columns[0].blocks;
        expect(blocks[0].id).toBe('message');
        expect(blocks[1].id).not.toBe(blocks[0].id);
        expect(blocks[1].props).toEqual(blocks[0].props);
    });

    it('clones complete sections with fresh descendant IDs', async () => {
        const save = vi.fn();
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} onSave={save} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'layers', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Clone section 1' }));
        expect(screen.getByRole('button', { name: 'Select section Section copy' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByText('Close', { exact: true }));
        await waitFor(() => expect(save).toHaveBeenCalledOnce());
        const sections = save.mock.calls[0][1].document.sections;
        expect(sections).toHaveLength(2);
        expect(sections[1].id).not.toBe(sections[0].id);
        expect(sections[1].columns[0].id).not.toBe(sections[0].columns[0].id);
        expect(sections[1].columns[0].blocks[0].id).not.toBe(sections[0].columns[0].blocks[0].id);
        expect(sections[1].columns[0].blocks[0].props).toEqual(sections[0].columns[0].blocks[0].props);
    });

    it('lets footer layers be cloned and deleted, with undo restoring deleted content', () => {
        const design = initialDesign();
        design.document.sections[0].columns[0].blocks.push({ id: 'footer', type: 'footer', props: { html: '<a href="{{unsubscribe_url}}">Unsubscribe</a>' } });
        render(<EmailDesignEditorV2 initialDesign={design} onSave={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'layers', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Clone Footer: Footer' }));
        expect(screen.getAllByRole('button', { name: 'Select Footer: Footer' })).toHaveLength(2);
        fireEvent.click(screen.getAllByRole('button', { name: 'Delete Footer: Footer' })[1]);
        fireEvent.click(screen.getByRole('button', { name: 'Delete Footer: Footer' }));
        expect(screen.queryByRole('button', { name: 'Select Footer: Footer' })).not.toBeInTheDocument();
        expect(screen.getByText('Marketing emails need an unsubscribe or preferences link, not just wording.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
        expect(screen.getByRole('button', { name: 'Select Footer: Footer' })).toBeVisible();
        expect(screen.queryByText('Marketing emails need an unsubscribe or preferences link, not just wording.')).not.toBeInTheDocument();
    });

    it('allows deleting the final section and restoring it with Undo', () => {
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} onSave={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'layers', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete section 1' }));
        expect(screen.getByText('Add a structure to start your email.')).toBeVisible();
        expect(screen.getByText('Select a section to edit its properties.')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
        expect(screen.getByRole('button', { name: 'Select Text: Saved message' })).toBeVisible();
    });

    it('keeps the inspector selection valid across cross-section moves and undo', async () => {
        const design = initialDesign();
        design.document.sections[0].name = 'First';
        design.document.sections.push({ id: 'second', name: 'Second', columns: [{ id: 'second-column', width: 100, blocks: [] }] });
        render(<EmailDesignEditorV2 initialDesign={design} onSave={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'layers', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Select Text: Saved message' }));
        fireEvent.keyDown(screen.getByRole('button', { name: 'Drag Text: Saved message' }), { altKey: true, key: 'ArrowDown' });
        const target = screen.getByLabelText('Column 1 in Second');
        expect(within(target).getByRole('button', { name: 'Select Text: Saved message' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('tab', { name: 'block' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
        await waitFor(() => expect(within(screen.getByRole('tabpanel')).getByLabelText('HTML')).toHaveValue('<p>Saved message</p>'));
        expect(within(screen.getByLabelText('Column 1 in First')).getByRole('button', { name: 'Select Text: Saved message' })).toHaveAttribute('aria-pressed', 'true');
    });

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
