import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ put: vi.fn(), account: 'a' }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: m.account } }) }));
vi.mock('../hooks/useSeoKeywords', () => ({
    useSearchConsoleStatus: () => ({ data: { connected: true, defaultSiteUrl: 'sc-domain:first.test', sites: [{ id: '1', siteUrl: 'sc-domain:first.test' }, { id: '2', siteUrl: 'sc-domain:second.test' }] } }),
    useSetDefaultSite: () => ({ mutateAsync: m.put }),
}));
vi.mock('../components/Seo/SeoKeywordsPanel', () => ({ SeoKeywordsPanel: ({ siteUrl }: { siteUrl: string }) => <p>Overview: {siteUrl}</p> }));
vi.mock('../components/Seo/KeywordTrackerPanel', () => ({ KeywordTrackerPanel: ({ siteUrl }: { siteUrl: string }) => <p>Suggestions: {siteUrl}</p> }));
import { SeoPage } from './SeoPage';
beforeEach(() => { m.put.mockReset(); m.account = 'a'; });
afterEach(cleanup);
it('commits site selection only after acknowledgement and exposes failures', async () => {
    m.put.mockRejectedValue(Error('offline')); render(<SeoPage />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sc-domain:second.test' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/previous selection remains active/); expect(screen.getByRole('combobox')).toHaveValue('sc-domain:first.test');
    m.put.mockResolvedValue({ success: true, defaultSiteUrl: 'sc-domain:second.test' }); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sc-domain:second.test' } });
    expect(await screen.findByText('Overview: sc-domain:second.test')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Keyword Tracker' })); expect(screen.getByText('Suggestions: sc-domain:second.test')).toBeInTheDocument();
});
it('does not install late default-site responses into another account', async () => {
    let resolve!: (value: unknown) => void; m.put.mockImplementation(() => new Promise(done => { resolve = done; }));
    const view = render(<SeoPage />); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sc-domain:second.test' } });
    expect(screen.getByRole('combobox')).toBeDisabled(); m.account = 'b'; view.rerender(<SeoPage />);
    await act(async () => resolve({ success: true, defaultSiteUrl: 'sc-domain:second.test' })); expect(screen.getByRole('combobox')).toHaveValue('sc-domain:first.test');
});
