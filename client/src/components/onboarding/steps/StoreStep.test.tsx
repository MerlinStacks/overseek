import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', logout: vi.fn() }) }));
vi.mock('../../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account-a' }, refreshAccounts: vi.fn(), setCurrentAccount: vi.fn() }) }));
import { createInitialDraft } from '../types';
import { StoreStep } from './StoreStep';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('verified store resumption', () => {
    it('aborts a connection test when the wizard scope unmounts', () => {
        const fetch = vi.fn().mockReturnValue(new Promise(() => {})); vi.stubGlobal('fetch', fetch);
        const draft = createInitialDraft(); draft.store = { ...draft.store, name: 'Store', wooUrl: 'https://store.example', wooConsumerKey: 'key', wooConsumerSecret: 'secret' };
        const view = render(<StoreStep draft={draft} setDraft={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} onSkip={vi.fn()} isSubmitting={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' })); expect(fetch).toHaveBeenCalledOnce();
        const signal = fetch.mock.calls[0][1].signal; view.unmount(); expect(signal.aborted).toBe(true);
    });
    it('can continue a matching verified account without restoring API credentials', () => {
        const draft = createInitialDraft(); draft.store = { ...draft.store, name: 'Store', wooUrl: 'https://store.example', connectionVerified: true, accountId: 'account-a' };
        const next = vi.fn(); render(<StoreStep draft={draft} setDraft={vi.fn()} onNext={next} onBack={vi.fn()} onSkip={vi.fn()} isSubmitting={false} />);
        const button = screen.getByRole('button', { name: 'Continue' }); expect(button).not.toBeDisabled(); fireEvent.click(button); expect(next).toHaveBeenCalledOnce();
    });
    it('does not accept another account’s verified state', () => {
        const draft = createInitialDraft(); draft.store = { ...draft.store, name: 'Store', wooUrl: 'https://store.example', connectionVerified: true, accountId: 'account-other' };
        render(<StoreStep draft={draft} setDraft={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} onSkip={vi.fn()} isSubmitting={false} />);
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });
});
