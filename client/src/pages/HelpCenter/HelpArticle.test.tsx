import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../data/helpContent', () => ({ getArticleBySlug: (slug: string) => slug === 'guide' ? { title: 'Guide', content: '# Section\n- **First** item\n- Second item\n\nParagraph', updatedAt: '2026-01-30', collection: { title: 'Guides' } } : null }));
import { HelpArticle } from './HelpArticle';
const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
    cleanup(); vi.restoreAllMocks();
    if (originalShare) Object.defineProperty(navigator, 'share', originalShare); else Reflect.deleteProperty(navigator, 'share');
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard); else Reflect.deleteProperty(navigator, 'clipboard');
});
function setup(slug = 'guide') { render(<MemoryRouter initialEntries={[`/help/article/${slug}`]}><Routes><Route path="/help/article/:slug" element={<HelpArticle />} /><Route path="/help" element={<p>Help Center</p>} /></Routes></MemoryRouter>); }
describe('help article controls', () => {
    it('renders semantic lists, inline emphasis, one page heading, and useful help navigation', () => {
        setup(); expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByText('First').tagName).toBe('STRONG');
        expect(screen.queryByRole('button', { name: 'Yes, thanks!' })).toBeNull();
        fireEvent.click(screen.getByRole('link', { name: /Browse the Help Center/ })); expect(screen.getByText('Help Center')).toBeInTheDocument();
    });
    it('prints and shares through the native share API', async () => {
        const print = vi.spyOn(window, 'print').mockImplementation(() => {});
        const share = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'share', { configurable: true, value: share });
        setup(); fireEvent.click(screen.getByRole('button', { name: 'Print article' })); expect(print).toHaveBeenCalledOnce();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share article' })); });
        expect(share).toHaveBeenCalledWith({ title: 'Guide', url: window.location.href }); expect(screen.getByRole('status')).toHaveTextContent('Article shared.');
    });
    it('falls back to copying and provides a selectable URL when copying fails', async () => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        const write = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
        setup(); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share article' })); });
        expect(screen.getByRole('status')).toHaveTextContent('Article link copied');
        write.mockRejectedValue(new Error('Denied'));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share article' })); });
        expect(screen.getByRole('alert')).toHaveTextContent('Copy the link below'); expect(screen.getByRole('textbox', { name: 'Article link' })).toHaveValue(window.location.href);
    });
    it('does not treat share cancellation as failure', async () => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')) });
        setup(); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share article' })); });
        expect(screen.queryByRole('alert')).toBeNull();
    });
    it('keeps the not-found recovery functional', () => { setup('missing'); fireEvent.click(screen.getByRole('button', { name: 'Back to Help Center' })); expect(screen.getByText('Help Center')).toBeInTheDocument(); });
});
