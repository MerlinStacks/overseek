import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminAccountsPage } from './AdminAccountsPage';

const refreshAccounts = vi.fn();
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'admin-token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'a' }, refreshAccounts }) }));

describe('super admin delivery toggle', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
    it('defaults on, persists explicit false, refreshes the active account and reports failures', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [
            { id: 'a', name: 'Default account', features: [], _count: { users: 1 } },
            { id: 'b', name: 'Disabled account', features: [{ id: 'f', featureKey: 'DELIVERY_ESTIMATES', isEnabled: false }], _count: { users: 1 } },
        ] }).mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Toggle failed' }) });
        vi.stubGlobal('fetch', fetchMock);
        render(<MemoryRouter><AdminAccountsPage /></MemoryRouter>);
        const defaultRow = (await screen.findByText('Default account')).closest('tr')!;
        const button = within(defaultRow).getByRole('button', { name: 'Delivery Estimates' });
        expect(button).toHaveAttribute('aria-pressed', 'true');
        const disabledRow = screen.getByText('Disabled account').closest('tr')!;
        expect(within(disabledRow).getByRole('button', { name: 'Delivery Estimates' })).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(button);
        await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'));
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ featureKey: 'DELIVERY_ESTIMATES', isEnabled: false });
        expect(refreshAccounts).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.click(button);
        expect(await screen.findByRole('alert')).toHaveTextContent('Toggle failed');
        expect(button).toHaveAttribute('aria-pressed', 'false');
    });
});
