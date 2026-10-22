import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), sender: true }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account' } }) }));
vi.mock('./SubjectExperimentPanel', () => ({ SubjectExperimentPanel: () => <div>Subject experiment</div> }));
import { CampaignReviewModal } from './CampaignReviewModal';
beforeEach(() => {
    mocks.sender = true; mocks.fetch.mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.fetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('audience-readiness') ? { matched: 20, eligible: 15, complete: true, excluded: { unsubscribed: 5 }, sender: mocks.sender ? { name: 'Store', email: 'store@example.com' } : null, note: 'Eligibility is rechecked at send time.' } : url.endsWith('/schedule') ? { scheduledAt: '2027-01-01T00:00:00Z' } : { name: 'Sale', subject: 'Shop now', content: '<a href="{{unsubscribe_url}}">Unsubscribe</a>', status: 'DRAFT' } }));
    vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = () => render(<CampaignReviewModal campaignId="campaign" onClose={vi.fn()} onChanged={vi.fn()} />);
it('explains matched versus eligible recipients and exclusion reasons', async () => {
    open(); expect(await screen.findByText('20 matched')).toBeInTheDocument();
    expect(screen.getByText('15 eligible')).toBeInTheDocument(); expect(screen.getByText('unsubscribed: 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send now' })).toBeEnabled();
});
it('blocks send when a sending account is missing', async () => {
    mocks.sender = false; open(); await screen.findByText('20 matched');
    expect(screen.getByRole('button', { name: 'Send now' })).toBeDisabled();
});
it('submits the chosen wall time and explicit timezone without browser-local conversion', async () => {
    open(); await screen.findByText('20 matched');
    fireEvent.change(screen.getByLabelText('Date and time'), { target: { value: '2027-01-01T11:00' } });
    fireEvent.change(screen.getByLabelText('IANA timezone'), { target: { value: 'Australia/Sydney' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/schedule'))).toBe(true));
    const call = mocks.fetch.mock.calls.find(([url]) => url.endsWith('/schedule'))!;
    expect(JSON.parse(call[1].body)).toEqual({ localTime: '2027-01-01T11:00', timezone: 'Australia/Sydney' });
});
