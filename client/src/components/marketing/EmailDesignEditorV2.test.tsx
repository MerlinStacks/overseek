import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('email designer integration', () => {
    it('keeps the desktop HTML viewport wider than the mobile CSS breakpoint', () => {
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} onSave={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByText('Real Email', { exact: true }));
        expect(screen.getByTitle('Compiled email HTML preview').parentElement).toHaveStyle({ width: '920px' });
        fireEvent.change(screen.getByLabelText('Preview device'), { target: { value: 'iphone-se' } });
        expect(screen.getByTitle('Compiled email HTML preview').parentElement).toHaveStyle({ width: '375px' });
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
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
        vi.stubGlobal('fetch', fetchMock);
        render(<EmailDesignEditorV2 initialDesign={initialDesign()} emailCategory="TRANSACTIONAL" previewOrderMode="none" onSave={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByText('Test', { exact: true }));
        fireEvent.click(screen.getByText('Send test', { exact: true }));
        await screen.findByText('Test email sent to tester@example.com.');
        const call = fetchMock.mock.calls.find(([url]) => url === '/api/marketing/test-email')!;
        expect(JSON.parse(call[1].body)).toMatchObject({ category: 'TRANSACTIONAL', previewText: 'Keep my preview', orderId: null });
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
