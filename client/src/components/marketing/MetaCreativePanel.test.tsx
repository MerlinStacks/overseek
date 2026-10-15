import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaCreativePanel } from './MetaCreativePanel';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'tenant' } }) }));

const metrics = { spend: 100, impressions: 2000, clicks: 100, purchases: 10, revenue: 500, ctr: 5, cpc: 1, cpa: 10, roas: 5 };
const creative = (id: string, name: string) => ({
    creative: { id, name, format: 'video', primaryTexts: ['Explore our new collection'], headlines: ['Find your style'], descriptions: [], callToActions: ['SHOP_NOW'], assets: [{ kind: 'video_thumbnail', url: `https://scontent.fbcdn.net/${id}.jpg` }], destinationUrl: null },
    metrics, ads: [{ id: '1', name: 'First ad', status: 'ACTIVE', frequency: 4 }],
    fatigue: { status: 'potential_fatigue', reasons: ['CTR has declined with repeated exposure.'], recent: metrics, previous: metrics }
});
const report = { adAccountId: 'connected', adsetId: '456', days: 30, currency: 'AUD', since: '2026-10-01', until: '2026-10-15', comparison: { recentSince: '2026-10-08', recentUntil: '2026-10-14', previousSince: '2026-10-01', previousUntil: '2026-10-07' }, creatives: [creative('500', 'First creative'), creative('501', 'Second creative')], warnings: ['No individual-asset attribution.'] };
const review = { summary: 'Make the product hook clearer.', strengths: ['Product is visible'], concerns: ['The offer is not prominent'], tests: [{ hypothesis: 'Test a closer crop', primaryText: 'Explore the collection', headline: 'See the details', visualBrief: 'A close-up product photo' }], caveats: ['Thumbnail only'], model: 'configured/model', reviewedAt: '2026-10-15', visualReview: { imagesProvided: 1, videoReviewed: false } };
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });

describe('Creative analysis workspace', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('/creative-review') ? review : report)));
    });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

    it('shows creative comparisons, copy, previews and bounded fatigue claims without automatically calling AI', async () => {
        render(<MetaCreativePanel adAccountId="connected" adsetId="456" days={30} />);
        await screen.findByRole('article', { name: 'Creative details: First creative' });
        expect(screen.getByText('Explore our new collection')).toBeInTheDocument();
        expect(screen.getByText('SHOP_NOW')).toBeInTheDocument();
        expect(screen.getByText('Video thumbnail only · video/audio not reviewed')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Creative fatigue signals' })).toBeInTheDocument();
        expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    });

    it('sends the selected creative scope and explicit image permission when requested', async () => {
        render(<MetaCreativePanel adAccountId="connected" adsetId="456" days={30} />);
        await screen.findByRole('article', { name: 'Creative details: First creative' });
        fireEvent.click(screen.getByRole('button', { name: /Second creative video/ }));
        fireEvent.click(screen.getByRole('checkbox', { name: /Include available images/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Analyze creative' }));
        await screen.findByText('Make the product hook clearer.');
        const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/creative-review'));
        expect(JSON.parse(request![1]!.body as string)).toEqual({ adsetId: '456', creativeId: '501', days: 30, includeVisuals: true });
        expect(screen.getByText('A close-up product photo')).toBeInTheDocument();
        expect(screen.getByText('Suggested creative tests')).toBeInTheDocument();
    });

    it('does not carry a review across creative selection', async () => {
        let finish: (value: ReturnType<typeof response>) => void = () => {};
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/creative-review') ? new Promise<ReturnType<typeof response>>(resolve => { finish = resolve; }) : response(report)));
        render(<MetaCreativePanel adAccountId="connected" adsetId="456" days={30} />);
        await screen.findByRole('article', { name: 'Creative details: First creative' });
        fireEvent.click(screen.getByRole('button', { name: 'Analyze creative' }));
        fireEvent.click(screen.getByRole('button', { name: /Second creative video/ }));
        await act(async () => finish(response(review)));
        expect(screen.queryByText('Make the product hook clearer.')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Analyze creative' })).toBeEnabled();
    });

    it('surfaces AI configuration failures instead of inventing a review', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/creative-review') ? response({ error: 'Configure your API key' }, false) : response(report)));
        render(<MetaCreativePanel adAccountId="connected" adsetId="456" days={30} />);
        await screen.findByRole('article', { name: 'Creative details: First creative' });
        fireEvent.click(screen.getByRole('button', { name: 'Analyze creative' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Configure your API key');
    });

    it('handles unavailable image previews gracefully', async () => {
        render(<MetaCreativePanel adAccountId="connected" adsetId="456" days={30} />);
        const image = await screen.findByRole('img', { name: 'First creative preview 1' });
        fireEvent.error(image);
        expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    });

    it('refetches creative reporting when the period changes', async () => {
        const { rerender } = render(<MetaCreativePanel adAccountId="connected" adsetId="456" days={30} />);
        await screen.findByRole('article', { name: 'Creative details: First creative' });
        rerender(<MetaCreativePanel adAccountId="connected" adsetId="456" days={7} />);
        await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/ads/connected/creatives?adsetId=456&days=7', expect.anything()));
    });
});
