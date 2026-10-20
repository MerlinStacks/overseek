import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ token: 'token', fetch: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: mocks.token }) }));
import { ChangePasswordModal } from './ChangePasswordModal';
beforeEach(() => { vi.resetAllMocks(); mocks.token = 'token'; vi.stubGlobal('fetch', mocks.fetch); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function fill() {
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'OldPass1' } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewPass2' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'NewPass2' } });
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
describe('password modal lifecycle', () => {
    it('labels visibility controls and resets passwords/visibility after external closure', () => {
        const view = render(<ChangePasswordModal isOpen onClose={vi.fn()} />); fill();
        fireEvent.click(screen.getByRole('button', { name: 'Show current password' })); expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'text');
        view.rerender(<ChangePasswordModal isOpen={false} onClose={vi.fn()} />);
        view.rerender(<ChangePasswordModal isOpen onClose={vi.fn()} />);
        expect(screen.getByLabelText('Current Password')).toHaveValue(''); expect(screen.getByLabelText('Current Password')).toHaveAttribute('type', 'password');
    });
    it('does not submit mismatched passwords', () => {
        render(<ChangePasswordModal isOpen onClose={vi.fn()} />); fill();
        fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'Mismatch1' } });
        expect(screen.getByRole('button', { name: 'Change Password' })).toBeDisabled(); submit(); expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it('clears sensitive inputs on success and cancels an old success-close timer when reopened', async () => {
        vi.useFakeTimers(); mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) }); const close = vi.fn();
        const view = render(<ChangePasswordModal isOpen onClose={close} />); fill(); await act(async () => { submit(); });
        expect(screen.getByRole('status')).toHaveTextContent('Password changed'); expect(screen.getByLabelText('Current Password')).toHaveValue('');
        view.rerender(<ChangePasswordModal isOpen={false} onClose={close} />); view.rerender(<ChangePasswordModal isOpen onClose={close} />);
        act(() => vi.advanceTimersByTime(2000)); expect(close).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Change Password' })).toBeInTheDocument();
    });
    it('aborts and ignores a response from a previous auth session', async () => {
        let resolve!: (value: unknown) => void; mocks.fetch.mockReturnValue(new Promise(r => { resolve = r; })); const close = vi.fn();
        const view = render(<ChangePasswordModal isOpen onClose={close} />); fill(); submit();
        const signal = mocks.fetch.mock.calls[0][1].signal;
        mocks.token = 'new-token'; view.rerender(<ChangePasswordModal isOpen onClose={close} />);
        await act(async () => { resolve({ ok: true, json: async () => ({}) }); });
        expect(signal.aborted).toBe(true); expect(screen.queryByRole('status')).toBeNull(); expect(screen.getByLabelText('New Password')).toHaveValue('');
    });
    it('shows a readable error for non-JSON failures and allows retry', async () => {
        mocks.fetch.mockResolvedValue({ ok: false, json: async () => { throw new Error('Invalid JSON'); } });
        render(<ChangePasswordModal isOpen onClose={vi.fn()} />); fill(); submit();
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to change password'));
        expect(screen.getByRole('button', { name: 'Change Password' })).not.toBeDisabled();
    });
});
