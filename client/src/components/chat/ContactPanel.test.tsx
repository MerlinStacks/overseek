import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ContactPanel } from './ContactPanel';

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ token: undefined }),
}));

vi.mock('../../context/AccountContext', () => ({
    useAccount: () => ({ currentAccount: { id: 'account-1', currency: 'USD' } }),
}));

vi.mock('./NotesSection', () => ({ NotesSection: () => null }));
vi.mock('./OrdersSection', () => ({ OrdersSection: () => null }));
vi.mock('./PreviousConversationsSection', () => ({ PreviousConversationsSection: () => null }));

const baseConversation = {
    id: 'conversation-1',
    status: 'OPEN',
    createdAt: '2026-08-06T12:00:00.000Z',
    updatedAt: '2026-08-06T12:00:00.000Z',
};

describe('ContactPanel', () => {
    it('links a known customer to their customer page', () => {
        render(
            <MemoryRouter>
                <ContactPanel
                    conversation={{
                        ...baseConversation,
                        wooCustomer: {
                            id: 'customer/id',
                            wooId: 42,
                            firstName: 'Laura',
                            lastName: 'Taylor',
                            email: 'lj.taylor@outlook.com',
                        },
                    }}
                />
            </MemoryRouter>,
        );

        expect(screen.getByRole('link', { name: 'View Laura Taylor customer page' }))
            .toHaveAttribute('href', '/customers/customer%2Fid');
    });

    it('does not show the customer-page button for an unlinked contact', () => {
        render(
            <MemoryRouter>
                <ContactPanel conversation={{ ...baseConversation, guestName: 'Guest Customer' }} />
            </MemoryRouter>,
        );

        expect(screen.queryByRole('link', { name: /customer page/i })).not.toBeInTheDocument();
    });
});
