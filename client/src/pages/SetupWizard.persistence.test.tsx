import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingStepProps } from '../components/onboarding/types';
const m = vi.hoisted(() => ({ user: { id: 'user-a' }, account: { id: 'account-a' }, accounts: [] as Array<{ id: string }> }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: m.user, isLoading: false, logout: vi.fn() }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account, accounts: m.accounts, isLoading: false, refreshAccounts: vi.fn() }) }));
vi.mock('../components/onboarding/OnboardingStepIndicator', () => ({ OnboardingStepIndicator: () => null }));
vi.mock('../components/onboarding/steps', () => {
    const step = (label: string) => ({ draft }: OnboardingStepProps) => <div><p>{label}</p><p>{draft.store.name || 'Empty draft'}</p></div>;
    return { StoreStep: step('Store step'), PluginStep: step('Plugin step'), EmailStep: step('Email step'), AdsStep: step('Ads step'), ReviewStep: step('Review step') };
});
import { createInitialDraft, saveDraftToStorage } from '../components/onboarding/types';
import { SetupWizard } from './SetupWizard';
function Page() { return <MemoryRouter initialEntries={['/setup']}><Routes><Route path="/setup" element={<SetupWizard />} /><Route path="/dashboard" element={<p>Dashboard redirect</p>} /></Routes></MemoryRouter>; }
beforeEach(() => { m.user = { id: 'user-a' }; m.account = { id: 'account-a' }; m.accounts = []; });
afterEach(() => { cleanup(); localStorage.clear(); });
describe('wizard persistence integration', () => {
    it('restores a matching verified account before applying the existing-account redirect', async () => {
        const draft = createInitialDraft(); draft.store = { ...draft.store, name: 'Private store', wooUrl: 'https://store.example', accountId: 'account-a', connectionVerified: true };
        saveDraftToStorage(draft, 3, { userId: 'user-a', mode: 'setup', accountId: 'account-a' }); m.accounts = [{ id: 'account-a' }];
        render(<Page />); await screen.findByText('Email step'); expect(screen.getByText('Private store')).toBeInTheDocument(); expect(screen.queryByText('Dashboard redirect')).toBeNull();
    });
    it('clears retained wizard state when the authenticated user changes', async () => {
        const draft = createInitialDraft(); draft.store.name = 'Private store'; saveDraftToStorage(draft, 1, { userId: 'user-a', mode: 'setup' });
        const view = render(<Page />); await screen.findByText('Private store'); m.user = { id: 'user-b' }; view.rerender(<Page />);
        await screen.findByText('Empty draft'); expect(screen.queryByText('Private store')).toBeNull();
    });
});
