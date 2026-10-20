import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailAccountList } from './EmailAccountList';
import type { EmailAccount } from './EmailAccountForm';
afterEach(cleanup);
const account: EmailAccount = { id: 'email-1', accountId: 'account', name: 'Support', email: 'support@example.com', smtpEnabled: true, imapEnabled: true };
describe('email account list', () => {
    it('labels actions and invokes the right callbacks without submitting', () => {
        const add = vi.fn(), edit = vi.fn(), remove = vi.fn(), setDefault = vi.fn(), submit = vi.fn(event => event.preventDefault());
        render(<form onSubmit={submit}><EmailAccountList accounts={[account]} onAdd={add} onEdit={edit} onDelete={remove} onSetDefault={setDefault} /></form>);
        fireEvent.click(screen.getByRole('button', { name: 'Add Account' }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit email account Support' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete email account Support' }));
        fireEvent.click(screen.getByRole('button', { name: 'Set Support as default email account' }));
        expect(add).toHaveBeenCalledOnce(); expect(edit).toHaveBeenCalledWith(account);
        expect(remove).toHaveBeenCalledWith(account.id); expect(setDefault).toHaveBeenCalledWith(account.id);
        expect(submit).not.toHaveBeenCalled();
    });
    it('preserves send-capability restrictions for default selection', () => {
        const view = render(<EmailAccountList accounts={[{ ...account, smtpEnabled: false }]} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onSetDefault={vi.fn()} />);
        expect(screen.queryByRole('button', { name: /as default/ })).toBeNull();
        view.rerender(<EmailAccountList accounts={[{ ...account, isDefault: true }]} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onSetDefault={vi.fn()} />);
        expect(screen.getByText('Default')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /as default/ })).toBeNull();
    });
    it('shows the empty state', () => {
        render(<EmailAccountList accounts={[]} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
        expect(screen.getByText('No email accounts configured.')).toBeInTheDocument();
    });
});
