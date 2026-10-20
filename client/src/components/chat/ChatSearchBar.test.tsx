import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatSearchBar } from './ChatSearchBar';
afterEach(cleanup);
describe('chat search keyboard scope', () => {
    it('handles Escape only inside search and respects IME composition', () => {
        const close = vi.fn(); render(<ChatSearchBar searchQuery="query" onSearchChange={vi.fn()} onClose={close} matchCount={2} totalCount={10} />);
        const input = screen.getByRole('textbox', { name: 'Search messages' }); fireEvent.keyDown(document, { key: 'Escape' }); expect(close).not.toHaveBeenCalled();
        fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: 'Escape' }); expect(close).not.toHaveBeenCalled(); fireEvent.compositionEnd(input);
        fireEvent.keyDown(input, { key: 'Escape', isComposing: true }); expect(close).not.toHaveBeenCalled();
        fireEvent.keyDown(input, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
    });
    it('announces loaded-message counts and keeps its close control out of form submission', () => {
        render(<ChatSearchBar searchQuery="query" onSearchChange={vi.fn()} onClose={vi.fn()} matchCount={2} totalCount={10} />);
        expect(screen.getByRole('status')).toHaveTextContent('2 of 10 loaded messages'); expect(screen.getByText('Searches loaded messages only.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close search' })).toHaveAttribute('type', 'button');
    });
});
