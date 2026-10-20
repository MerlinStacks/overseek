import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), assign: vi.fn(), remove: vi.fn(), error: null as Error | null }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'a' } }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../hooks/useSeoKeywords', () => ({
    useKeywordGroups: () => ({ data: { groups: [{ id: 'group', name: 'Group', color: '#123456', keywordCount: 1, totalClicks: 1 }] }, error: mocks.error, refetch: vi.fn() }),
    useTrackedKeywords: () => ({ data: { keywords: [{ id: 'kw', keyword: 'Keyword' }] }, refetch: vi.fn() }),
    useCreateGroup: () => ({ mutateAsync: mocks.create }), useAssignKeywordsToGroup: () => ({ mutateAsync: mocks.assign }), useDeleteGroup: () => ({ mutateAsync: mocks.remove }),
}));
import { KeywordGroupsTab } from './KeywordGroupsTab';
beforeEach(() => { vi.resetAllMocks(); mocks.error = null; vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('keyword group mutations', () => {
    it('reports failed creates while preserving the entered name', async () => {
        mocks.create.mockRejectedValue(new Error('Failed')); render(<KeywordGroupsTab />);
        fireEvent.click(screen.getByRole('button', { name: 'New Group' })); fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Draft' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save')); expect(screen.getByLabelText('Group name')).toHaveValue('Draft');
    });
    it('guards composition, repeated Enter and duplicate creation requests', async () => {
        let resolve!: () => void; mocks.create.mockReturnValue(new Promise<void>(r => { resolve = r; })); render(<KeywordGroupsTab />);
        fireEvent.click(screen.getByRole('button', { name: 'New Group' })); const input = screen.getByLabelText('Group name'); fireEvent.change(input, { target: { value: 'Draft' } });
        fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); fireEvent.keyDown(input, { key: 'Enter', repeat: true }); expect(mocks.create).not.toHaveBeenCalled();
        fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' }); expect(mocks.create).toHaveBeenCalledOnce();
        await act(async () => { resolve(); }); expect(screen.queryByLabelText('Group name')).toBeNull();
    });
    it('labels colors and group controls, and retains assignment selection after failure', async () => {
        mocks.assign.mockRejectedValue(new Error('Failed')); render(<KeywordGroupsTab />);
        fireEvent.click(screen.getByRole('button', { name: 'New Group' })); expect(screen.getByRole('button', { name: 'Use color #3b82f6' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel creating group' })); fireEvent.click(screen.getByRole('button', { name: 'Assign keywords to Group' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Keyword' })); fireEvent.click(screen.getByRole('button', { name: 'Assign 1 keywords' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save')); expect(screen.getByRole('checkbox', { name: 'Keyword' })).toBeChecked();
    });
    it('surfaces delete failures', async () => {
        mocks.remove.mockRejectedValue(new Error('Failed')); render(<KeywordGroupsTab />); fireEvent.click(screen.getByRole('button', { name: 'Delete group Group' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save'));
    });
});
