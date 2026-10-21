import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../components/HelpCenter/HelpSearch', () => ({ HelpSearch: () => <input aria-label="Search help" /> }));
vi.mock('../data/helpContent', () => ({ getHelpCollections: () => [{ id: 'test', title: 'Collection', articles: Array.from({ length: 6 }, (_, id) => ({ id, title: `Article ${id}`, slug: `article-${id}` })) }] }));
import { DesignerProperties } from './DesignerProperties';
import { DesignerSidebar } from './DesignerSidebar';
import { HelpCenterHome } from './HelpCenter/HelpCenterHome';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('designer uploads', () => {
    const items = [{ id: 'a', type: 'image', content: '' }, { id: 'b', type: 'image', content: '' }];
    it('binds uploads to the item/account/template and ignores late completions after a switch', async () => {
        let resolve!: (value: unknown) => void; const fetchMock = vi.fn(() => new Promise(r => { resolve = r; })); vi.stubGlobal('fetch', fetchMock); const update = vi.fn();
        const props = { items, selectedId: 'a', token: 'token', accountId: 'account', templateId: 'template', onUpdateItem: update, onDeleteItem: vi.fn(), onClose: vi.fn() };
        const view = render(<DesignerProperties {...props} />); const input = view.container.querySelector('input[type=file]')!;
        fireEvent.change(input, { target: { files: [new File(['image'], 'a.png', { type: 'image/png' })] } }); const signal = fetchMock.mock.calls[0][1].signal;
        view.rerender(<DesignerProperties {...props} selectedId="b" />); expect(signal.aborted).toBe(true);
        await act(async () => { resolve({ ok: true, json: async () => ({ success: true, url: '/uploads/invoices/image.png' }) }); }); expect(update).not.toHaveBeenCalled();
    });
    it('blocks duplicate uploads and rejects malformed confirmations without changing the image', async () => {
        let resolve!: (value: unknown) => void; const fetchMock = vi.fn(() => new Promise(r => { resolve = r; })); vi.stubGlobal('fetch', fetchMock); const update = vi.fn();
        const view = render(<DesignerProperties items={items} selectedId="a" token="token" accountId="account" onUpdateItem={update} onDeleteItem={vi.fn()} onClose={vi.fn()} />);
        const input = view.container.querySelector('input[type=file]')!; const files = [new File(['image'], 'a.png', { type: 'image/png' })]; fireEvent.change(input, { target: { files } }); fireEvent.change(input, { target: { files } }); expect(fetchMock).toHaveBeenCalledOnce();
        await act(async () => { resolve({ ok: true, json: async () => ({ success: true, url: 'javascript:bad' }) }); }); expect(await screen.findByRole('alert')).toHaveTextContent('existing image is unchanged'); expect(update).not.toHaveBeenCalled();
    });
    it('offers a native upload control and validates empty files before sending', () => {
        const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
        const view = render(<DesignerProperties items={items} selectedId="a" token="token" accountId="account" onUpdateItem={vi.fn()} onDeleteItem={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Choose image' })).toHaveAttribute('type', 'button');
        fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [new File([], 'a.png', { type: 'image/png' })] } }); expect(screen.getByRole('alert')).toBeInTheDocument(); expect(fetchMock).not.toHaveBeenCalled();
    });
});
describe('accessible palettes and help navigation', () => {
    it('uses non-submit buttons for adding designer components', () => {
        const add = vi.fn(); render(<DesignerSidebar onAddItem={add} />); const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0); expect(buttons.every(button => button.getAttribute('type') === 'button')).toBe(true); fireEvent.click(buttons[0]); expect(add).toHaveBeenCalledOnce();
    });
    it('makes hidden help articles reachable and uses native article links', async () => {
        render(<MemoryRouter><HelpCenterHome /></MemoryRouter>); expect(screen.queryByRole('link', { name: 'Article 5' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'View all 6 articles' })); await waitFor(() => expect(screen.getByRole('link', { name: 'Article 5' })).toHaveAttribute('href', '/help/article/article-5'));
        expect(screen.getByRole('button', { name: 'Show fewer articles' })).toHaveAttribute('aria-expanded', 'true');
    });
});
