import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';
afterEach(cleanup);
describe('empty state action', () => {
    it('invokes its action without submitting a surrounding form', () => {
        const action = vi.fn(), submit = vi.fn(event => event.preventDefault());
        render(<form onSubmit={submit}><EmptyState icon={null} title="No data" action={{ label: 'Refresh', onClick: action }} /></form>);
        const button = screen.getByRole('button', { name: 'Refresh' }); fireEvent.click(button);
        expect(action).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
        expect(button).toHaveClass('motion-reduce:transition-none', 'motion-reduce:transform-none');
    });
});
