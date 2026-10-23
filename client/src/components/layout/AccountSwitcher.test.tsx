import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ setCurrentAccount: vi.fn(), accounts: [{ id: 'a', name: 'Alpha', domain: 'alpha.test', appearance: undefined as { appName?: string; logoUrl?: string } | undefined }, { id: 'b', name: 'Beta', domain: 'beta.test', appearance: undefined as { appName?: string; logoUrl?: string } | undefined }] }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ ...mocks, currentAccount: mocks.accounts[0] }) }));
import { AccountSwitcher } from './AccountSwitcher';
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.accounts.forEach(account => { account.appearance = undefined; }); });
function Location() { return <div data-testid="location">{useLocation().search}</div>; }
function setup() {
    render(<MemoryRouter><AccountSwitcher /><button>Outside</button><Location /></MemoryRouter>);
    return screen.getByRole('button', { name: 'Switch account: Alpha' });
}
describe('account switcher disclosure', () => {
    it('uses saved business identity and falls back when a logo fails', () => {
        mocks.accounts[0].appearance = { appName: 'Alpha Studio', logoUrl: '/brand.png' };
        const trigger = setup();
        expect(trigger).toHaveTextContent('Alpha Studio');
        fireEvent.error(trigger.querySelector('img')!);
        expect(trigger.querySelector('img')).not.toBeInTheDocument();
        expect(trigger.querySelector('.bg-\\[var\\(--primary-color\\)\\]')).toHaveTextContent('A');
        fireEvent.click(trigger);
        expect(screen.getByRole('button', { name: 'Alpha Studio' })).toBeInTheDocument();
    });
    it('supports keyboard opening, selection, and Escape with focus restoration', async () => {
        const user = userEvent.setup(); const trigger = setup();
        await user.tab(); await user.keyboard('{Enter}');
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await user.tab(); expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus();
        await user.tab(); await user.keyboard('{Enter}');
        expect(mocks.setCurrentAccount).toHaveBeenCalledWith(mocks.accounts[1]);
        expect(trigger).toHaveFocus(); expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await user.keyboard('{Enter}'); await user.tab(); await user.keyboard('{Escape}');
        expect(trigger).toHaveFocus(); expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
    it('closes when focus or a pointer leaves and marks the current account', () => {
        const trigger = setup(); fireEvent.click(trigger);
        expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.blur(trigger, { relatedTarget: screen.getByRole('button', { name: 'Outside' }) });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(trigger); fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
    it('closes when navigating to account creation', () => {
        const trigger = setup(); fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: 'Create New Account' }));
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId('location')).toHaveTextContent('?addNew=true');
    });
});
