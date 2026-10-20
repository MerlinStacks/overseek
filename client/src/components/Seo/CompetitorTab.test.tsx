import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: { id: 'a' }, add: vi.fn(), remove: vi.fn(), refresh: vi.fn(), retry: vi.fn(), error: null as Error | null }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../hooks/useSeoKeywords', () => ({
    useCompetitors: () => ({ data: { competitors: [{ id: 'comp', domain: 'competitor.test', keywordCount: 1, avgPosition: 2, lastCheckedAt: null }] }, error: mocks.error, refetch: mocks.retry }),
    useAddCompetitor: () => ({ mutateAsync: mocks.add }), useRemoveCompetitor: () => ({ mutateAsync: mocks.remove }), useRefreshCompetitorPositions: () => ({ mutateAsync: mocks.refresh }),
    useCompetitorKeywords: () => ({ data: { keywords: [{ id: 'kw', keyword: 'Keyword', currentPosition: 2, positionChange: null, rankingUrl: 'invalid URL' }] } }),
    useCompetitorMovement: () => ({ data: { movements: [] } }), useCompetitorHeadToHead: () => ({ data: { rows: [] } })
}));
import { CompetitorTab } from './CompetitorTab';
beforeEach(() => { vi.resetAllMocks(); mocks.account = { id: 'a' }; mocks.error = null; vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('competitor tab safeguards', () => {
    it('provides keyboard-accessible selection and tolerates malformed ranking URLs', () => {
        render(<CompetitorTab />); const select = screen.getByRole('button', { name: 'Select competitor competitor.test' }); select.focus(); expect(select).toHaveFocus();
        fireEvent.click(select); expect(select).toHaveAttribute('aria-pressed', 'true'); expect(screen.getByText('URL unavailable')).toBeInTheDocument();
    });
    it('surfaces failed deletes while preserving selection', async () => {
        mocks.remove.mockRejectedValue(new Error('Failed')); render(<CompetitorTab />);
        fireEvent.click(screen.getByRole('button', { name: 'Select competitor competitor.test' })); fireEvent.click(screen.getByRole('button', { name: 'Remove competitor competitor.test' }));
        await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Select competitor competitor.test' })).toHaveAttribute('aria-pressed', 'true');
    });
    it('guards composition and duplicate add requests and retains failed input', async () => {
        let resolve!: (value: unknown) => void; mocks.add.mockReturnValue(new Promise(r => { resolve = r; })); render(<CompetitorTab />);
        const input = screen.getByRole('textbox', { name: 'Competitor domain' }); fireEvent.change(input, { target: { value: 'new.test' } });
        fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); fireEvent.keyDown(input, { key: 'Enter', repeat: true }); expect(mocks.add).not.toHaveBeenCalled();
        fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' }); expect(mocks.add).toHaveBeenCalledOnce();
        await act(async () => { resolve({}); }); expect(input).toHaveValue('');
        mocks.add.mockRejectedValue(new Error('Failed')); fireEvent.change(input, { target: { value: 'draft.test' } }); fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        await screen.findByRole('alert'); expect(input).toHaveValue('draft.test');
    });
    it('resets account-specific drafts and selection', () => {
        const view = render(<CompetitorTab />); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'private.test' } });
        mocks.account = { id: 'b' }; view.rerender(<CompetitorTab />); expect(screen.getByRole('textbox')).toHaveValue('');
    });
    it('reports fetch errors without an empty-data claim', async () => {
        mocks.error = new Error('Unavailable'); render(<CompetitorTab />); expect(screen.getByRole('alert')).toHaveTextContent('Could not load competitors');
        fireEvent.click(screen.getByRole('button', { name: 'Retry competitors' })); await waitFor(() => expect(mocks.retry).toHaveBeenCalledOnce()); expect(screen.queryByText('No competitors tracked yet')).toBeNull();
    });
});
