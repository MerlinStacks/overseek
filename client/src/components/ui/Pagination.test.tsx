import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Pagination } from './Pagination';

afterEach(cleanup);

it('keeps navigation compact without losing accessible control names', () => {
    const change = vi.fn();
    render(<Pagination currentPage={2} totalPages={10} onPageChange={change} />);
    for (const name of ['First Page', 'Previous Page', 'Next Page', 'Last Page']) {
        const button = screen.getByRole('button', { name });
        expect(button).toHaveAttribute('type', 'button');
        expect(button).toHaveClass('size-9');
        expect(button.querySelector('svg')).not.toBeNull();
    }
    expect(screen.getByRole('spinbutton', { name: 'Go to' })).toHaveValue(2);
    fireEvent.click(screen.getByRole('button', { name: 'Next Page' }));
    expect(change).toHaveBeenCalledWith(3);
});

it('preserves the row-size selector and re-enables navigation after a page change', () => {
    const change = vi.fn(), size = vi.fn();
    const view = render(<Pagination currentPage={1} totalPages={10} onPageChange={change} allowItemsPerPage itemsPerPage={25} onItemsPerPageChange={size} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '50' } });
    expect(size).toHaveBeenCalledWith(50);
    expect(screen.getByRole('button', { name: 'Previous Page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next Page' }));
    view.rerender(<Pagination currentPage={2} totalPages={10} onPageChange={change} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next Page' }));
    expect(change.mock.calls).toEqual([[2], [3]]);
});
