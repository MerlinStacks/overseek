import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import RoleManager from './RoleManager';

vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: (key: string) => key === 'manage_roles' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'custom-role-account' } }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'role-token' }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

it('lets a delegated role manager register manage_inventory on a custom inventory role', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    render(<RoleManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Role' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Packing Staff'), { target: { value: 'Inventory operator' } });
    fireEvent.click(screen.getByLabelText('Manage Inventory (Delivery Cutover & Receipt Reconciliation)'));
    fireEvent.click(screen.getByLabelText('View Shipping Hub'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Role' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/roles', expect.objectContaining({ method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer role-token', 'x-account-id': 'custom-role-account' },
        body: JSON.stringify({ name: 'Inventory operator', permissions: { manage_inventory: true, view_shipping: true } }),
    })));
});
