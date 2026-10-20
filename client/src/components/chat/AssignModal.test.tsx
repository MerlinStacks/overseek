import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: { id: 'a' }, fetch: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
import { AssignModal } from './AssignModal';
const member = { id: 'u', email: 'user@example.com', fullName: 'User' };
beforeEach(() => { vi.resetAllMocks(); mocks.account = { id: 'a' }; vi.stubGlobal('fetch', mocks.fetch); mocks.fetch.mockResolvedValue({ ok: true, json: async () => [member] }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('assignment modal lifecycle', () => {
    it('reports a failed assignment, keeps the dialog open and permits retry', async () => {
        const assign = vi.fn().mockRejectedValueOnce(new Error('Failure')).mockResolvedValue(undefined); const close = vi.fn();
        render(<AssignModal isOpen onClose={close} onAssign={assign} />);
        fireEvent.click(await screen.findByRole('button', { name: 'User user@example.com' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not assign'));
        expect(close).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'User user@example.com' })); await waitFor(() => expect(close).toHaveBeenCalledOnce());
    });
    it('distinguishes load failures from an empty team and supports retry', async () => {
        mocks.fetch.mockResolvedValueOnce({ ok: false });
        render(<AssignModal isOpen onClose={vi.fn()} onAssign={vi.fn()} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load team');
        expect(screen.queryByText('No team members found')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Retry loading team' }));
        expect(await screen.findByRole('button', { name: 'User user@example.com' })).toBeInTheDocument();
    });
    it('hides stale team data and aborts pending loads when the account changes', async () => {
        let resolve!: (value: unknown) => void;
        mocks.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const view = render(<AssignModal isOpen onClose={vi.fn()} onAssign={vi.fn()} />);
        const signal = mocks.fetch.mock.calls[0][1].signal;
        mocks.account = { id: 'b' }; mocks.fetch.mockResolvedValue({ ok: true, json: async () => [] });
        view.rerender(<AssignModal isOpen onClose={vi.fn()} onAssign={vi.fn()} />);
        await act(async () => { resolve({ ok: true, json: async () => [member] }); });
        expect(signal.aborted).toBe(true); expect(screen.queryByRole('button', { name: 'User user@example.com' })).toBeNull();
        expect(screen.getByText('No team members found')).toBeInTheDocument();
    });
    it('allows unassignment even if the current team is empty', async () => {
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => [] }); const assign = vi.fn().mockResolvedValue(undefined);
        render(<AssignModal isOpen currentAssigneeId="old" onClose={vi.fn()} onAssign={assign} />);
        await screen.findByText('No team members found'); fireEvent.click(screen.getByRole('button', { name: 'Unassign' }));
        expect(assign).toHaveBeenCalledWith('');
        await act(async () => {});
    });
    it('ignores assignment completion after close and reopen', async () => {
        let resolve!: () => void; const assign = vi.fn(() => new Promise<void>(r => { resolve = r; })); const close = vi.fn();
        const view = render(<AssignModal isOpen onClose={close} onAssign={assign} />);
        fireEvent.click(await screen.findByRole('button', { name: 'User user@example.com' }));
        view.rerender(<AssignModal isOpen={false} onClose={close} onAssign={assign} />);
        view.rerender(<AssignModal isOpen onClose={close} onAssign={assign} />);
        await act(async () => { resolve(); }); expect(close).not.toHaveBeenCalled();
    });
});
