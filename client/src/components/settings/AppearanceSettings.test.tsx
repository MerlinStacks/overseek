import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSettings } from './AppearanceSettings';

const m = vi.hoisted(() => ({
    account: { id: 'a', name: 'Account A', appearance: { appName: 'Brand A', primaryColor: '#ffffff', logoUrl: '' } },
    api: { isReady: true },
    service: { getBranding: vi.fn(), importBranding: vi.fn(), saveBranding: vi.fn() },
    toast: { success: vi.fn(), error: vi.fn() },
    wholesale: false,
}));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account, refreshAccounts: vi.fn() }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => m.toast }));
vi.mock('../../hooks/useApi', () => ({ useApi: () => m.api }));
vi.mock('../../hooks/useAccountFeature', () => ({ useAccountFeature: () => m.wholesale }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
vi.mock('../../services/wholesaleCatalogService', () => ({ createWholesaleCatalogService: () => m.service }));
vi.mock('./WholesaleBrandingSettings', () => ({ WholesaleBrandingSettings: () => null }));

beforeEach(() => {
    vi.clearAllMocks();
    m.wholesale = false;
    m.account = { id: 'a', name: 'Account A', appearance: { appName: 'Brand A', primaryColor: '#ffffff', logoUrl: '' } };
});
afterEach(cleanup);

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

    it('does not apply a previous account’s late branding response to the next account', async () => {
        m.wholesale = true;
        let resolve!: (value: unknown) => void;
        m.service.getBranding.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockReturnValueOnce(new Promise(() => {}));
        const view = render(<AppearanceSettings />);
        m.account = { id: 'b', name: 'Account B', appearance: { appName: '', primaryColor: '', logoUrl: '' } };
        view.rerender(<AppearanceSettings />);
        await act(async () => resolve({ branding: { businessDetails: { name: 'Leaked A' }, logoUrl: '/a.png', primaryColor: '#ff0000' } }));
        expect(screen.getByRole('region', { name: 'Appearance preview' })).toHaveTextContent('Account B');
        expect(screen.queryByText('Leaked A')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Primary colour hex value')).toHaveValue('#2563eb');
    });
});
