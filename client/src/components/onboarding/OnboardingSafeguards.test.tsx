import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, token: 'token' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: m.token }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
import { EmailStep } from './steps/EmailStep';
import { ReviewStep } from './steps/ReviewStep';
import { OnboardingStepIndicator } from './OnboardingStepIndicator';
import { createInitialDraft, type OnboardingDraft } from './types';
beforeEach(() => { m.account = { id: 'a' }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function initial() {
    const draft = createInitialDraft(); draft.store = { ...draft.store, name: 'Store', accountId: 'a', connectionVerified: true };
    draft.email = { ...draft.email, enabled: true, name: 'Support', email: 'support@store.test', smtpHost: 'smtp.store.test', smtpUsername: 'user', smtpPassword: 'secret' }; return draft;
}
function Harness({ initialDraft = initial() }: { initialDraft?: OnboardingDraft }) {
    const [draft, setDraft] = useState(initialDraft);
    return <><EmailStep draft={draft} setDraft={setDraft} onNext={vi.fn()} onSkip={vi.fn()} onBack={vi.fn()} isSubmitting={false} /><output data-testid="draft">{JSON.stringify(draft.email)}</output></>;
}
const response = (data: unknown) => ({ ok: true, json: async () => data });
describe('onboarding SMTP evidence', () => {
    it('separates a connection test from saving and invalidates both when settings change', async () => {
        const fetch = vi.fn().mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response({ id: 'email-id' })); vi.stubGlobal('fetch', fetch);
        render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Test SMTP Connection' })); await screen.findByText(/Connection test passed/);
        expect(screen.getByTestId('draft')).toHaveTextContent('"verified":true'); expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Save email configuration' })); await screen.findByText(/Sending account saved/); expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
        expect(fetch.mock.calls[1][0]).toBe('/api/email/accounts'); expect(JSON.parse(fetch.mock.calls[1][1].body).smtpEnabled).toBe(true);
        fireEvent.change(screen.getByLabelText('SMTP Host'), { target: { value: 'changed.test' } }); expect(screen.getByTestId('draft')).toHaveTextContent('"verified":false'); expect(screen.getByTestId('draft')).toHaveTextContent('"configured":false'); expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });
    it('aborts the test when the account changes and ignores its late result', async () => {
        let resolve!: (value: unknown) => void; const fetch = vi.fn().mockReturnValue(new Promise(r => { resolve = r; })); vi.stubGlobal('fetch', fetch);
        const view = render(<Harness />); const button = screen.getByRole('button', { name: 'Test SMTP Connection' }); fireEvent.click(button); fireEvent.click(button); expect(fetch).toHaveBeenCalledOnce(); const signal = fetch.mock.calls[0][1].signal;
        m.account = { id: 'b' }; view.rerender(<Harness />); await act(async () => { resolve(response({ success: true })); }); expect(signal.aborted).toBe(true); expect(screen.getByTestId('draft')).toHaveTextContent('"verified":false');
    });
    it('does not substitute port 587 when the port is cleared or fractional', () => {
        render(<Harness />); fireEvent.change(screen.getByLabelText('Port'), { target: { value: '' } }); expect(screen.getByLabelText('Port')).toHaveValue(null); expect(screen.getByRole('button', { name: 'Test SMTP Connection' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Port'), { target: { value: '587.5' } }); expect(screen.getByLabelText('Port')).toHaveValue(587.5); expect(screen.getByRole('button', { name: 'Test SMTP Connection' })).toBeDisabled();
    });
    it('locks test settings and navigation while saving', async () => {
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {}))); const draft = initial(); draft.email.verified = true; draft.email.verifiedAccountId = 'a';
        render(<Harness initialDraft={draft} />); fireEvent.click(screen.getByRole('button', { name: 'Save email configuration' }));
        await waitFor(() => expect(screen.getByLabelText('SMTP Host')).toBeDisabled()); expect(screen.getByRole('button', { name: 'Skip for now' })).toBeDisabled();
    });
});
describe('onboarding progress and review', () => {
    it('has one state for conflicting flags and no enabled no-op steps', () => {
        render(<OnboardingStepIndicator currentStep={4} completedSteps={[2]} skippedSteps={[2]} />);
        expect(screen.getAllByRole('button').every(button => (button as HTMLButtonElement).disabled)).toBe(true); expect(screen.getByText('Skipped')).toBeInTheDocument(); expect(screen.queryByText('Completed')).toBeNull(); expect(screen.getAllByRole('listitem')[3]).toHaveAttribute('aria-current', 'step');
    });
    it('accepts account-bound verified stores without credentials but never calls tested-only email ready', () => {
        const draft = initial(); draft.email.verified = true;
        const view = render(<ReviewStep draft={draft} setDraft={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} onSkip={vi.fn()} isSubmitting={false} />);
        expect(screen.getAllByText('Ready')).toHaveLength(1); expect(screen.getByText(/Connection tested only/)).toBeInTheDocument();
        m.account = { id: 'b' }; view.rerender(<ReviewStep draft={draft} setDraft={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} onSkip={vi.fn()} isSubmitting={false} />); expect(screen.queryByText('Ready')).toBeNull(); expect(screen.getByRole('button', { name: 'Complete Setup' })).toBeDisabled();
    });
});
