import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MobileNav } from './MobileNav';

function Location() {
    return <output data-testid="location">{useLocation().pathname}</output>;
}

afterEach(cleanup);

describe('companion navigation', () => {
    it('announces active destinations and badge counts, and navigates', () => {
        render(<MemoryRouter><MobileNav activeTab="dashboard" inboxBadge={125} ordersBadge={3} /><Location /></MemoryRouter>);
        expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Orders, 3 pending' })).not.toHaveAttribute('aria-current');
        fireEvent.click(screen.getByRole('button', { name: 'Inbox, 125 unread' }));
        expect(screen.getByTestId('location')).toHaveTextContent('/m/inbox');
        expect(screen.getByText('99+')).toBeInTheDocument();
    });
});
