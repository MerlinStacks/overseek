import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BroadcastsPage } from './BroadcastsPage';
vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }));

const mocks = vi.hoisted(() => ({ account: { id: 'account-1' }, designer: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('../components/marketing/CampaignsList', () => ({ CampaignsList: ({ onEdit }: { onEdit: (id: string, name: string) => void }) => <button onClick={() => onEdit('campaign-1', 'Sale')}>Edit email</button> }));
vi.mock('../components/marketing/MarketingEmailDesigner', () => ({ MarketingEmailDesigner: (props: unknown) => { mocks.designer(props); return <div>Loaded designer</div>; } }));

beforeEach(() => { mocks.designer.mockClear(); mocks.account = { id: 'account-1' }; });
afterEach(() => vi.unstubAllGlobals());

describe('broadcast editor loading', () => {
    it('mounts the designer only after the saved design has loaded', async () => {
        let resolve!: (value: unknown) => void;
        vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done; })));
        render(<BroadcastsPage />);
        fireEvent.click(screen.getByText('Edit email'));
        expect(screen.getByRole('status')).toHaveTextContent('Loading');
        expect(mocks.designer).not.toHaveBeenCalled();
        const designJson = { document: { meta: { previewText: 'Keep this preview' } } };
        await act(async () => resolve({ ok: true, json: async () => ({ name: 'Saved', subject: '', content: '<p>Saved content</p>', designJson }) }));
        await screen.findByText('Loaded designer');
        expect(mocks.designer).toHaveBeenLastCalledWith(expect.objectContaining({ initialDesign: designJson, initialSubject: '', initialHtml: '<p>Saved content</p>', storageScope: 'campaign:campaign-1' }));
    });

    it('does not expose a blank editable email after a failed request and supports retry', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => ({ subject: 'Recovered', designJson: {} }) });
        vi.stubGlobal('fetch', fetchMock);
        render(<BroadcastsPage />);
        fireEvent.click(screen.getByText('Edit email'));
        await screen.findByRole('alert');
        expect(mocks.designer).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('Retry'));
        await screen.findByText('Loaded designer');
    });

    it('ignores a late response after closing the loader', async () => {
        let resolve!: (value: unknown) => void;
        vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done; })));
        render(<BroadcastsPage />);
        fireEvent.click(screen.getByText('Edit email'));
        fireEvent.click(screen.getByText('Back to broadcasts'));
        await act(async () => resolve({ ok: true, json: async () => ({ subject: 'Late', designJson: {} }) }));
        expect(screen.getByText('Edit email')).toBeInTheDocument();
        expect(mocks.designer).not.toHaveBeenCalled();
    });

    it('does not save the old campaign into a newly selected account', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ subject: 'Saved', designJson: {} }) });
        vi.stubGlobal('fetch', fetchMock);
        const { rerender } = render(<BroadcastsPage />);
        fireEvent.click(screen.getByText('Edit email'));
        await waitFor(() => expect(mocks.designer).toHaveBeenCalled());
        mocks.account = { id: 'account-2' };
        rerender(<BroadcastsPage />);
        expect(screen.getByText('Edit email')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});
