import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { HelpSearch } from './HelpSearch';
const articles = vi.hoisted(() => [
    { id: '1', slug: 'inventory-basics', title: 'Inventory basics', excerpt: 'Manage inventory', collection: { title: 'Inventory' } },
    { id: '2', slug: 'inventory-stock', title: 'Inventory stock', excerpt: 'Track stock', collection: { title: 'Inventory' } },
]);
vi.mock('../../data/helpContent', () => ({ searchArticles: (query: string) => articles.filter(article => article.title.toLowerCase().includes(query.toLowerCase())) }));
function Location() { return <div data-testid="location">{useLocation().pathname}</div>; }
beforeEach(() => {
    render(<MemoryRouter><HelpSearch /><Location /><button>Outside</button></MemoryRouter>);
});
afterEach(() => { cleanup(); });
const input = () => screen.getByRole('combobox', { name: 'Search help articles' });
const search = (query = 'inventory') => { fireEvent.focus(input()); fireEvent.change(input(), { target: { value: query } }); };
describe('help search', () => {
    it('opens results while typing without requiring blur and refocus', () => {
        search();
        expect(input()).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getAllByRole('option')).toHaveLength(2);
    });
    it('ignores short and whitespace-only queries', () => {
        search('   ');
        expect(input()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('listbox')).toBeNull();
        fireEvent.change(input(), { target: { value: 'in' } });
        expect(screen.queryByRole('listbox')).toBeNull();
    });
    it('supports arrow navigation and Enter selection with active-descendant semantics', () => {
        search();
        fireEvent.keyDown(input(), { key: 'ArrowDown' });
        fireEvent.keyDown(input(), { key: 'ArrowDown' });
        const selected = screen.getAllByRole('option')[1];
        expect(selected).toHaveAttribute('aria-selected', 'true');
        expect(input()).toHaveAttribute('aria-activedescendant', selected.id);
        fireEvent.keyDown(input(), { key: 'Enter' });
        expect(screen.getByTestId('location')).toHaveTextContent('/help/article/inventory-stock');
        expect(input()).toHaveValue('');
        expect(screen.queryByRole('listbox')).toBeNull();
    });
    it('supports ArrowUp, Escape, and reopening without losing the query', () => {
        search();
        fireEvent.keyDown(input(), { key: 'ArrowUp' });
        expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(input(), { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(input()).toHaveValue('inventory');
        fireEvent.keyDown(input(), { key: 'ArrowDown' });
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    });
    it('selects the first result on Enter when no arrow selection has been made', () => {
        search(); fireEvent.keyDown(input(), { key: 'Enter' });
        expect(screen.getByTestId('location')).toHaveTextContent('/help/article/inventory-basics');
    });
    it('preserves pointer selection without relying on delayed blur timers', () => {
        search();
        const option = screen.getAllByRole('option')[0];
        fireEvent.pointerDown(option); fireEvent.click(option);
        expect(screen.getByTestId('location')).toHaveTextContent('/help/article/inventory-basics');
    });
    it('announces empty results and closes immediately on blur', () => {
        search('not-found');
        expect(screen.getByRole('status')).toHaveTextContent('No articles found');
        fireEvent.blur(input(), { relatedTarget: screen.getByRole('button', { name: 'Outside' }) });
        expect(screen.queryByRole('status')).toBeNull();
    });
    it('does not navigate while the IME is composing', () => {
        search(); fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
        expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    });
});
