import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleAdsCampaigns } from './GoogleAdsCampaigns';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'tenant' } }) }));
vi.mock('./CampaignProductsPanel', () => ({ CampaignProductsPanel: () => <p>Google products</p> }));

const campaign = {
    campaignId: '123', campaignName: 'Summer sale', status: 'ACTIVE', spend: 50, impressions: 1000, clicks: 20,
    conversions: 2, conversionsValue: 150, roas: 3, ctr: 2, cpc: 2.5, cpa: 25, currency: 'AUD'
};
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });

describe('Ad campaign performance', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async (input: string) => {
            if (input.includes('/analysis')) return response({ suggestions: ['Review your creatives'] });
            if (input.includes('/creatives?')) return response({ creatives: [], warnings: [] });
            if (input.includes('/meta-entities')) return response([{ ...campaign, campaignId: '456', campaignName: 'Retargeting ad set' }]);
            if (input.includes('/trends')) return response([]);
            return response([campaign]);
        }));
    });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

    it('opens Meta ad sets and ads instead of the Google products endpoint', async () => {
        render(<GoogleAdsCampaigns adAccountId="meta" accountName="Meta account" platform="META" onBack={() => {}} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Expand Summer sale' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Retargeting ad set' }));
        await screen.findByRole('region', { name: 'Ads' });
        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('level=adset&parentId=123'), expect.anything());
        expect(fetch).toHaveBeenCalledWith(expect.stringContaining('level=ad&parentId=456'), expect.anything());
        expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/products'))).toBe(false);
    });

    it('retains Google product expansion', async () => {
        render(<GoogleAdsCampaigns adAccountId="google" accountName="Google" onBack={() => {}} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Expand Summer sale' }));
        expect(screen.getByText('Google products')).toBeInTheDocument();
    });

    it('refreshes recommendations for the chosen reporting period and supports search', async () => {
        render(<GoogleAdsCampaigns adAccountId="meta" accountName="Meta" platform="META" onBack={() => {}} />);
        await screen.findByText('Summer sale');
        fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: '7' } });
        await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/ads/meta/analysis?days=7', expect.anything()));
        await screen.findByText('Summer sale');
        fireEvent.change(screen.getByLabelText('Search campaigns'), { target: { value: 'missing' } });
        expect(screen.getByText('No campaigns found for this period')).toBeInTheDocument();
        expect(screen.getByText('Purchase Revenue')).toBeInTheDocument();
    });

    it('shows a failure instead of zero-value metrics when reporting fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'Token expired' }, false)));
        render(<GoogleAdsCampaigns adAccountId="meta" accountName="Meta" platform="META" onBack={() => {}} />);
        await screen.findByText('Token expired');
        expect(screen.queryByText('Total Spend')).not.toBeInTheDocument();
    });

    it('ignores late recommendations from the previous reporting period', async () => {
        let resolveOld: (value: ReturnType<typeof response>) => void = () => {};
        vi.stubGlobal('fetch', vi.fn(async (input: string) => {
            if (input.includes('/analysis?days=30')) return new Promise<ReturnType<typeof response>>(resolve => { resolveOld = resolve; });
            if (input.includes('/analysis')) return response({ suggestions: ['Current period recommendation'] });
            if (input.includes('/trends')) return response([]);
            return response([campaign]);
        }));
        render(<GoogleAdsCampaigns adAccountId="meta" accountName="Meta" platform="META" onBack={() => {}} />);
        await screen.findByText('Summer sale');
        fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: '7' } });
        await screen.findByText('Current period recommendation');
        await act(async () => { resolveOld(response({ suggestions: ['Outdated recommendation'] })); });
        expect(screen.queryByText('Outdated recommendation')).not.toBeInTheDocument();
        expect(screen.getByText('Current period recommendation')).toBeInTheDocument();
    });
});
