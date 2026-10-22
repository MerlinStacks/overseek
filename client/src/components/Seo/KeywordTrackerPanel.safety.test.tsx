import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn(), bulk: vi.fn(), refresh: vi.fn(), readError: null as Error | null }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u' }, token: 't' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'a' } }) }));
vi.mock('../../hooks/useSeoKeywords', () => ({
    useSearchConsoleStatus: () => ({ data: { connected: true }, isLoading: false }),
    useTrackedKeywords: () => ({ data: { keywords: [] }, isLoading: false, error: m.readError, refetch: vi.fn() }),
    useAddKeyword: () => ({ mutateAsync: m.add }), useDeleteKeyword: () => ({ mutateAsync: m.remove }), useBulkImportKeywords: () => ({ mutateAsync: m.bulk }), useRefreshKeywords: () => ({ mutateAsync: m.refresh }),
    useKeywordRecommendations: () => ({ data: { lowHangingFruit: [], aiRecommendations: [] }, isLoading: false }),
    useKeywordHistory: () => ({ data: { history: [] }, isLoading: false }),
}));
vi.mock('./KeywordGroupsTab', () => ({ KeywordGroupsTab: () => null }));
vi.mock('./CompetitorTab', () => ({ CompetitorTab: () => null }));
vi.mock('./RevenueTab', () => ({ RevenueTab: () => null }));
vi.mock('./HealthTab', () => ({ HealthTab: () => null }));
vi.mock('./DigestTab', () => ({ DigestTab: () => null }));
import { KeywordTrackerPanel } from './KeywordTrackerPanel';
beforeEach(() => { vi.clearAllMocks(); m.readError = null; });
afterEach(cleanup);
it('serializes Enter-key adds and retains text after failure', async () => {
    let reject!: (cause: Error) => void; m.add.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    render(<KeywordTrackerPanel siteUrl="sc-domain:store.test" />); fireEvent.click(screen.getByRole('button', { name: 'Track' }));
    const input = screen.getByRole('textbox', { name: 'Keyword to track' }); fireEvent.change(input, { target: { value: 'keyword' } });
    fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' }); expect(m.add).toHaveBeenCalledTimes(1);
    await act(async () => reject(Error('offline'))); expect(screen.getByRole('alert')).toHaveTextContent(/Could not add/); expect(input).toHaveValue('keyword');
});
it('bounds and deduplicates imports while retaining partial-failure drafts', async () => {
    m.bulk.mockResolvedValue({ added: 1, skipped: 0, failed: 1 }); render(<KeywordTrackerPanel />); fireEvent.click(screen.getByRole('button', { name: 'Bulk' }));
    const input = screen.getByRole('textbox', { name: 'Keywords to import, one per line' }); fireEvent.change(input, { target: { value: 'One\none\nTwo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import All' })); expect(await screen.findByRole('alert')).toHaveTextContent(/Import did not complete/);
    expect(m.bulk).toHaveBeenCalledWith({ keywords: ['one', 'two'] }); expect(input).toHaveValue('One\none\nTwo');
});
it('surfaces list errors and labels account-wide scope instead of claiming a site-filtered tracker', () => {
    m.readError = Error('offline'); render(<KeywordTrackerPanel siteUrl="sc-domain:store.test" />);
    expect(screen.getByRole('button', { name: 'Retry tracked keywords' })).toBeInTheDocument(); expect(screen.getByText(/management tabs are account-wide/)).toBeInTheDocument();
    expect(screen.queryByText('No keywords tracked yet.')).toBeNull();
});
