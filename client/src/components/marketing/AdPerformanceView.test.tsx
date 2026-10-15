import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdPerformanceView } from './AdPerformanceView';

const state = vi.hoisted(() => ({ accountId: 'tenant-1' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: state.accountId } }) }));
vi.mock('./GoogleAdsCampaigns', () => ({ GoogleAdsCampaigns: ({ accountName, platform }: { accountName: string; platform: string }) => <p>Reporting: {accountName} ({platform})</p> }));

const accounts = (id: string, name: string) => ({ ok: true, json: async () => [{ id, name, platform: 'META', externalId: '123' }] });

describe('Ad account navigation', () => {
    beforeEach(() => { state.accountId = 'tenant-1'; });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

    it('shows failed account requests as errors rather than an empty connection list, and supports retry', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ ok: false })
            .mockResolvedValueOnce(accounts('meta', 'Recovered account')));
        render(<AdPerformanceView />);
        await screen.findByRole('alert');
        expect(screen.queryByText('No Ad Accounts Connected')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByText('Reporting: Recovered account (META)');
    });

    it('resets the selected ad account when the tenant changes', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(accounts('first', 'First account'))
            .mockResolvedValueOnce(accounts('second', 'Second account')));
        const { rerender } = render(<AdPerformanceView />);
        await screen.findByText('Reporting: First account (META)');
        state.accountId = 'tenant-2';
        rerender(<AdPerformanceView />);
        await screen.findByText('Reporting: Second account (META)');
        expect(screen.queryByText('Reporting: First account (META)')).not.toBeInTheDocument();
    });
});
