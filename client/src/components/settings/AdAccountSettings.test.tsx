import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdAccountSettings } from './AdAccountSettings';

const mocks = vi.hoisted(() => ({ account: { id: 'tenant' }, navigate: vi.fn().mockReturnValue(true) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('../../hooks/useAccountFeature', () => ({ useAccountFeature: () => true }));
vi.mock('../../utils/url', () => ({ navigateToSafeUrl: mocks.navigate }));
vi.mock('./AdAccountModals', () => ({ EditAdAccountModal: () => null, PendingSetupModal: () => null }));
vi.mock('./AdConnectForm', () => ({ AdConnectForm: () => null }));

describe('Reauthorising an existing Google Ads connection', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('uses reconnectId and keeps the existing account rather than deleting/recreating it', async () => {
        const fetch = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => {
            if (url === '/api/ads') return [{ id: 'existing-account', name: 'Google shop', platform: 'GOOGLE', externalId: '1234567890' }];
            if (url.includes('/insights')) return { spend: 100, currency: 'AUD', roas: 2, impressions: 1000, clicks: 10 };
            return { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?scope=adwords%20datamanager' };
        } }));
        vi.stubGlobal('fetch', fetch);
        render(<AdAccountSettings />);
        fireEvent.click(await screen.findByRole('button', { name: 'Reconnect Google Ads account' }));
        await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
        const [url, options] = fetch.mock.calls.find(([url]) => url.startsWith('/api/oauth/google/authorize'))!;
        const params = new URL(url, 'https://overseek.example').searchParams;
        expect(params.get('reconnectId')).toBe('existing-account');
        expect(params.get('redirect')).toBe('/settings?tab=ads');
        expect(options.headers['X-Account-ID']).toBe('tenant');
        expect(fetch.mock.calls.some(([, options]) => options?.method === 'DELETE' || options?.method === 'POST')).toBe(false);
    });
});
