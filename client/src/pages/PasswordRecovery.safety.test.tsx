import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('serializes reset-email attempts and ignores server-provided account disclosure text', async () => {
    let resolve!: (value: unknown) => void; fetchMock.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
    const form = screen.getByRole('button', { name: 'Send reset link' }).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form); expect(fetchMock).toHaveBeenCalledOnce(); expect(screen.getByLabelText('Email')).toBeDisabled();
    await act(async () => resolve({ ok: true, json: async () => ({ message: 'This email exists!' }) }));
    expect(screen.getByRole('status')).toHaveTextContent('If an account exists'); expect(screen.queryByText('This email exists!')).not.toBeInTheDocument();
});
function ResetHarness() { const navigate = useNavigate(); return <><button onClick={() => navigate(`/reset-password?token=${'b'.repeat(64)}`)}>Other link</button><ResetPasswordPage /></>; }
it('remounts on token changes and ignores a late old-token response', async () => {
    let resolve!: (value: unknown) => void; fetchMock.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<MemoryRouter initialEntries={[`/reset-password?token=${'a'.repeat(64)}`]}><ResetHarness /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'long-password' } }); fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'long-password' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Reset password' }).closest('form')!);
    const signal = fetchMock.mock.calls[0][1].signal; fireEvent.click(screen.getByText('Other link')); expect(signal.aborted).toBe(true);
    await act(async () => resolve({ ok: true, json: async () => ({ message: 'Success' }) })); expect(screen.queryByRole('status')).not.toBeInTheDocument(); expect(screen.getByLabelText('New password')).toHaveValue('');
});
it('does not allow a consumed-success form to submit again', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: 'Success' }) });
    render(<MemoryRouter initialEntries={[`/?token=${'a'.repeat(64)}`]}><ResetPasswordPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'long-password' } }); fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'long-password' } });
    const form = screen.getByRole('button', { name: 'Reset password' }).closest('form')!; fireEvent.submit(form); await screen.findByRole('status'); fireEvent.submit(form); expect(fetchMock).toHaveBeenCalledOnce(); expect(screen.getByLabelText('New password')).toHaveValue('');
});
