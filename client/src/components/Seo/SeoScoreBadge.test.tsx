import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SeoScoreBadge } from './SeoScoreBadge';
afterEach(() => { cleanup(); });
describe('SEO score badge', () => {
    it('opens with the keyboard and closes on Escape', async () => {
        const user = userEvent.setup();
        render(<SeoScoreBadge score={80} tests={[{ test: 'Title', passed: true, message: 'Passed' }, { test: 'Description', passed: false, message: 'Too short' }]} />);
        await user.tab();
        const button = screen.getByRole('button', { name: 'SEO score 80 out of 100' });
        expect(button).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('region')).toHaveTextContent('Too short');
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('region')).toBeNull();
    });
    it('supports click/tap toggling, outside dismissal, and mouse preview', () => {
        render(<><SeoScoreBadge score={50} /><button>Outside</button></>);
        const button = screen.getByRole('button', { name: 'SEO score 50 out of 100' });
        fireEvent.click(button);
        expect(screen.getByRole('region')).toHaveTextContent('No SEO analysis available.');
        fireEvent.click(button);
        expect(screen.queryByRole('region')).toBeNull();
        fireEvent.mouseEnter(button.parentElement!);
        expect(screen.getByRole('region')).toBeInTheDocument();
        fireEvent.mouseLeave(button.parentElement!);
        expect(screen.queryByRole('region')).toBeNull();
        fireEvent.click(button);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
        expect(screen.queryByRole('region')).toBeNull();
    });
    it('makes the empty-analysis state reachable', () => {
        render(<SeoScoreBadge score={0} tests={[]} />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByRole('region')).toHaveTextContent('No SEO analysis available.');
    });
    it.each([[200, '100/100'], [-20, '0/100'], [75.6, '76/100'], [NaN, 'N/A'], [Infinity, 'N/A']])('normalizes score %s without displaying invalid numbers', (score, expected) => {
        render(<SeoScoreBadge score={score} />);
        expect(screen.getByRole('button')).toHaveTextContent(expected);
    });
    it('supports a non-interactive badge inside an existing details button without nesting controls', () => {
        render(<button type="button"><SeoScoreBadge score={50} interactive={false} />View details</button>);
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button').querySelector('button')).toBeNull();
    });
});
