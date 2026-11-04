import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSettings } from './AppearanceSettings';

const m = vi.hoisted(() => ({
    account: { id: 'a', name: 'Account A', appearance: { appName: 'Brand A', primaryColor: '#ffffff', logoUrl: '' } },
    toast: { success: vi.fn(), error: vi.fn() },
    canEdit: true,
}));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account, refreshAccounts: vi.fn() }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => m.toast }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => m.canEdit }) }));

beforeEach(() => {
    vi.clearAllMocks();
    m.canEdit = true;
    m.account = { id: 'a', name: 'Account A', appearance: { appName: 'Brand A', primaryColor: '#ffffff', logoUrl: '' } };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('appearance preview and account isolation', () => {
    it('previews draft identity with the same accessible foreground as mobile and desktop', () => {
        render(<AppearanceSettings />);
        const preview = screen.getByRole('region', { name: 'Appearance preview' });
        expect(preview).toHaveStyle('--mobile-brand: #ffffff; --mobile-brand-foreground: #000000');
        expect(within(preview).getByText('Brand A')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Primary colour hex value'), { target: { value: '#000000' } });
        expect(preview).toHaveStyle('--mobile-brand: #000000; --mobile-brand-foreground: #ffffff');
        fireEvent.change(screen.getByLabelText('Brand name', { exact: false }), { target: { value: 'Draft name' } });
        expect(within(preview).getByText('Draft name')).toBeInTheDocument();
    });

    it('does not carry draft branding to the next account', () => {
        const view = render(<AppearanceSettings />);
        fireEvent.change(screen.getByLabelText('Brand name', { exact: false }), { target: { value: 'Draft A' } });
        m.account = { id: 'b', name: 'Account B', appearance: { appName: '', primaryColor: '', logoUrl: '' } };
        view.rerender(<AppearanceSettings />);
        expect(screen.getByRole('region', { name: 'Appearance preview' })).toHaveTextContent('Account B');
        expect(screen.queryByText('Draft A')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Primary colour hex value')).toHaveValue('#2563eb');
    });

    it('saves existing workspace branding without calling the retired catalog API', async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetch);
        render(<AppearanceSettings />);
        fireEvent.click(screen.getByRole('button', { name: 'Save branding' }));
        await waitFor(() => expect(m.toast.success).toHaveBeenCalled());
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith('/api/accounts/a', expect.objectContaining({
            method: 'PUT',
            body: expect.stringContaining('"appName":"Brand A"'),
        }));
    });

    it('keeps appearance preview-only without workspace permissions', () => {
        m.canEdit = false;
        render(<AppearanceSettings />);
        expect(screen.queryByRole('button', { name: 'Save branding' })).not.toBeInTheDocument();
    });
});
