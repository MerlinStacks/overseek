import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartingPointCard } from './StartingPointCard';
afterEach(cleanup);
describe('flow starting point', () => {
    it('invokes event and recipe actions without submitting a surrounding form', () => {
        const event = vi.fn(), recipe = vi.fn(), submit = vi.fn(e => e.preventDefault());
        render(<form onSubmit={submit}><StartingPointCard onClick={event} onRecipeClick={recipe} /></form>);
        fireEvent.click(screen.getByRole('button', { name: 'Select an Event' }));
        fireEvent.click(screen.getByRole('button', { name: 'Use Recipe' }));
        expect(event).toHaveBeenCalledOnce(); expect(recipe).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
    });
    it('omits the recipe action when unavailable', () => {
        render(<StartingPointCard onClick={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Use Recipe' })).toBeNull();
    });
});
