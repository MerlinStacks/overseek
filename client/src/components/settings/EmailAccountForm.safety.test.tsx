import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: 'a' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: { id: 'u' } }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: m.account } }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
import { EmailAccountForm } from './EmailAccountForm';
afterEach(() => { cleanup(); vi.restoreAllMocks(); m.account = 'a'; });
const initial = { id: 'mail', accountId: 'a', name: 'Support', email: 'synthetic@example.test', smtpEnabled: true, smtpHost: 'smtp.example.test', smtpPort: 587, smtpSecure: true, smtpPassword: '••••••••', updatedAt: '2026-01-01T00:00:00.000Z' };
it('never copies masked secrets into replacement fields and preserves a rejected draft under one occurrence', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const save = vi.fn().mockRejectedValue(new Error('conflict'));
    render(<EmailAccountForm initialData={initial} onSave={save} onCancel={vi.fn()} onTest={vi.fn()} isSaving={false} isTesting={false} testResult={null} />);
    expect(screen.getByLabelText(/SMTP Password/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Changed support' } });
    const button = screen.getByRole('button', { name: 'Save reviewed account' }); fireEvent.click(button); fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('reconcile'); expect(save).toHaveBeenCalledOnce(); expect(screen.getByLabelText('name')).toHaveValue('Changed support'); expect(button).toBeDisabled();
    expect(save.mock.calls[0][0]).toMatchObject({ version: initial.updatedAt, operationId: expect.any(String), smtpPassword: '' });
});
it('rejects fractional ports before any save/test is admitted', () => {
    const save = vi.fn();
    render(<EmailAccountForm initialData={{ ...initial, smtpPort: 587.5 }} onSave={save} onCancel={vi.fn()} onTest={vi.fn()} isSaving={false} isTesting={false} testResult={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save reviewed account' }));
    expect(screen.getByRole('status')).toHaveTextContent('integer ports'); expect(save).not.toHaveBeenCalled();
});
