import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveAnalyticsPage } from './LiveAnalyticsPage';

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: account }) }));
const { account } = vi.hoisted(() => ({ account: { id: 'account-1' } }));
vi.mock('../hooks/useVisibilityPolling', () => ({ useVisibilityPolling: vi.fn() }));
vi.mock('../components/analytics/AnalyticsOverview', () => ({ AnalyticsOverview: () => null }));
vi.mock('../components/analytics/WebVitalsView', () => ({ WebVitalsView: () => null }));
vi.mock('../components/analytics/VisitorsTable', () => ({ VisitorsTable: () => null }));
vi.mock('../components/analytics/UrlBuilder', () => ({ UrlBuilder: () => null }));
vi.mock('../components/analytics/RoadblocksView', () => ({ RoadblocksView: () => null }));
vi.mock('../components/analytics/VisitorProfileModal', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Pages report loading', () => {
    it('preserves unified titles and metrics without merging independently limited entry/exit reports', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [{
                url: 'https://shop.test/product/gift/', title: 'Gift - Shop',
                views: 20, entries: 5, exits: 4, exitRate: 20,
            }],
        });
        vi.stubGlobal('fetch', fetchMock);
        render(<LiveAnalyticsPage />);
        fireEvent.click(screen.getByRole('button', { name: 'Pages' }));

        expect(await screen.findByText('Gift - Shop')).toBeInTheDocument();
        expect(screen.getByText('20.00%')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
        expect(screen.queryByText('Untitled')).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/analytics/behaviour/pages?startDate='), {
            headers: { Authorization: 'Bearer token', 'x-account-id': 'account-1' },
        });

        fireEvent.change(screen.getByRole('combobox'), { target: { value: '7d' } });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock.mock.calls[1][0]).not.toBe(fetchMock.mock.calls[0][0]);
        expect(fetchMock.mock.calls.every(([url]) => url.includes('/behaviour/pages?'))).toBe(true);
    });
});
