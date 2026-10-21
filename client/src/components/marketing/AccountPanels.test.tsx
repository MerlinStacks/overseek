import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, fetch: vi.fn() }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../ui/Modal', () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));
import { AdContextModal } from './AdContextModal';
import { AdIntelligencePanel } from './AdIntelligencePanel';
import { CampaignProductsPanel } from './CampaignProductsPanel';
const response = (value: unknown) => ({ ok: true, json: async () => value });
beforeEach(() => { vi.resetAllMocks(); m.account = { id: 'a' }; vi.stubGlobal('fetch', m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('business context lifecycle', () => {
    it('aborts old account reads and never fills the new account with a late draft', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const props = { isOpen: true, onClose: vi.fn() }; const view = render(<AdContextModal {...props} />);
        await waitFor(() => expect(m.fetch).toHaveBeenCalledOnce()); const signal = m.fetch.mock.calls[0][1].signal;
        m.account = { id: 'b' }; m.fetch.mockResolvedValue(response({ context: 'Account B' })); view.rerender(<AdContextModal {...props} />);
        await screen.findByDisplayValue('Account B'); await act(async () => { resolve(response({ context: 'Private A' })); });
        expect(signal.aborted).toBe(true); expect(screen.queryByDisplayValue('Private A')).toBeNull();
    });
    it('does not permit an empty overwrite after a failed read, and supports retry', async () => {
        m.fetch.mockResolvedValueOnce({ ok: false }).mockResolvedValue(response({ context: 'Saved notes' }));
        render(<AdContextModal isOpen onClose={vi.fn()} />); await screen.findByRole('alert'); expect(screen.queryByRole('textbox')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Retry context' })); await screen.findByDisplayValue('Saved notes');
    });
    it('serializes saves, preserves failed drafts, and aborts when closed', async () => {
        m.fetch.mockResolvedValueOnce(response({ context: 'Original' })); const close = vi.fn();
        const view = render(<AdContextModal isOpen onClose={close} />); await screen.findByDisplayValue('Original');
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited' } });
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const save = screen.getByRole('button', { name: 'Save Context' }); fireEvent.click(save); fireEvent.click(save);
        expect(m.fetch).toHaveBeenCalledTimes(2); await act(async () => { resolve({ ok: false }); });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not save'); expect(screen.getByRole('textbox')).toHaveValue('Edited'); expect(close).not.toHaveBeenCalled();
        m.fetch.mockReturnValue(new Promise(() => {})); fireEvent.click(screen.getByRole('button', { name: 'Save Context' }));
        const signal = m.fetch.mock.calls.at(-1)![1].signal; view.rerender(<AdContextModal isOpen={false} onClose={close} />); expect(signal.aborted).toBe(true);
    });
});
const summary = { currency: 'EUR', overlapCount: 0, organicOnlyCount: 1, estimatedWastedSpend: 12, cannibalizationCount: 0, negativeCandidates: 0, hasData: true };
describe('search intelligence', () => {
    it('uses ad currency and exposes correlation failures with a working retry', async () => {
        m.fetch.mockImplementation((url: string) => Promise.resolve(url.endsWith('summary') ? response(summary) : { ok: false }));
        render(<AdIntelligencePanel />); await screen.findByRole('alert'); expect(screen.getByText(/EUR/)).toBeInTheDocument();
        m.fetch.mockResolvedValue(response({ currency: 'EUR', overlap: [], organicOnly: [{ query: 'Opportunity', position: 2, clicks: 10, ctr: 5, estimatedPaidValue: 8 }] }));
        fireEvent.click(screen.getByRole('button', { name: 'Retry correlation' })); await screen.findByText('Opportunity');
        expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText(/\d+% confidence/)).toBeNull();
        expect(screen.getByRole('button', { name: /Organic Keyword Opportunities/ })).toHaveAttribute('aria-expanded', 'true');
    });
    it('handles malformed summaries instead of crashing on numeric formatting', async () => {
        m.fetch.mockResolvedValue(response({ ...summary, estimatedWastedSpend: 'invalid' })); render(<AdIntelligencePanel />); await screen.findByRole('alert');
    });
});
const product = { productId: 'p', productTitle: 'Product', productBrand: 'Brand', spend: 25, clicks: 2, conversions: 0.5, roas: 1, currency: 'EUR' };
describe('campaign product reads', () => {
    it('aborts stale campaign responses and preserves fractional conversion counts', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const view = render(<CampaignProductsPanel adAccountId="ads" campaignId="old" days={30} />);
        await waitFor(() => expect(m.fetch).toHaveBeenCalledOnce()); const signal = m.fetch.mock.calls[0][1].signal;
        m.fetch.mockResolvedValue(response([product])); view.rerender(<CampaignProductsPanel adAccountId="ads" campaignId="new/campaign" days={30} />);
        await screen.findByText('0.5'); await act(async () => { resolve(response([{ ...product, productTitle: 'Private old product' }])); });
        expect(signal.aborted).toBe(true); expect(screen.queryByText('Private old product')).toBeNull(); expect(m.fetch.mock.calls.at(-1)![0]).toContain('new%2Fcampaign');
    });
    it('rejects malformed product metrics and allows retry', async () => {
        m.fetch.mockResolvedValueOnce(response([{ ...product, roas: null }])).mockResolvedValue(response([]));
        render(<CampaignProductsPanel adAccountId="ads" campaignId="campaign" days={30} />); await screen.findByRole('alert');
        fireEvent.click(screen.getByRole('button', { name: 'Retry products' })); await screen.findByText(/No products available/);
    });
});
