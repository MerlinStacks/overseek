import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AudiencesPage } from './AudiencesPage';

vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'tenant' } }) }));
vi.mock('./SegmentsPage', () => ({ SegmentsPage: () => <p>Unified segments list</p> }));
vi.mock('./EmailListsPage', () => ({ EmailListsPage: () => <p>Email lists</p> }));

function Location() { return <p data-testid="location">{useLocation().search}</p>; }

describe('Audiences navigation', () => {
    it('has only Segments and Lists, including for old advertising bookmarks', async () => {
        render(<MemoryRouter initialEntries={['/emails/audiences?tab=advertising']}><AudiencesPage /><Location /></MemoryRouter>);
        expect(screen.getAllByRole('tab')).toHaveLength(2);
        expect(screen.queryByRole('tab', { name: 'Advertising' })).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Segments' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('Unified segments list')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?tab=segments'));
    });
    it('preserves the legacy Lists route', () => {
        render(<MemoryRouter initialEntries={['/emails/lists']}><AudiencesPage /></MemoryRouter>);
        expect(screen.getByRole('tab', { name: 'Lists' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('Email lists')).toBeInTheDocument();
    });
});
