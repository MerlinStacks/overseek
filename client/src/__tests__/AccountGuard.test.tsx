import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useState } from 'react';
import { AccountGuard } from '../App';

const state = vi.hoisted(() => ({
    accounts: [] as { id: string }[], isLoading: false, loadError: null as string | null,
    hasLoaded: false, refreshAccounts: vi.fn(),
}));
vi.mock('../context/AccountContext', () => ({ useAccount: () => state, AccountProvider: () => null }));
afterEach(() => { cleanup(); state.accounts = []; state.loadError = null; state.hasLoaded = false; state.refreshAccounts.mockClear(); });

function Page() {
    const [value, setValue] = useState('');
    return <input aria-label="Draft" value={value} onChange={event => setValue(event.target.value)} />;
}
function GuardedRoute() {
    return <MemoryRouter initialEntries={['/orders']}><Routes>
        <Route path="/orders" element={<AccountGuard><Page /></AccountGuard>} />
        <Route path="/wizard" element={<div>Setup wizard</div>} />
    </Routes></MemoryRouter>;
}

describe('AccountGuard', () => {
    it('offers retry for failed hydration without redirecting to setup', () => {
        state.loadError = 'Unable to load your accounts. Please try again.';
        render(<GuardedRoute />);
        expect(screen.getByRole('alert')).toHaveTextContent(state.loadError);
        expect(screen.queryByText('Setup wizard')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(state.refreshAccounts).toHaveBeenCalledOnce();
    });

    it('redirects only after successful empty hydration', () => {
        const view = render(<GuardedRoute />);
        expect(screen.queryByText('Setup wizard')).toBeNull();
        state.hasLoaded = true;
        view.rerender(<GuardedRoute />);
        expect(screen.getByText('Setup wizard')).toBeInTheDocument();
    });

    it('preserves mounted page state through background errors and recovery', () => {
        state.accounts = [{ id: 'a1' }];
        state.hasLoaded = true;
        const view = render(<GuardedRoute />);
        fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Unsaved draft' } });
        state.loadError = 'Temporary failure';
        view.rerender(<GuardedRoute />);
        expect(screen.getByLabelText('Draft')).toHaveValue('Unsaved draft');
        state.loadError = null;
        view.rerender(<GuardedRoute />);
        expect(screen.getByLabelText('Draft')).toHaveValue('Unsaved draft');
    });
});
