import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', currency: 'EUR' } }));
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
import { StepBudgetReview } from './StepBudgetReview';
import { StepGoalType } from './StepGoalType';
import { StepProductSelection } from './StepProductSelection';
import { createInitialDraft, validateStep } from '../types';
beforeEach(() => { m.account = { id: 'a', currency: 'EUR' }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (data: unknown) => ({ ok: true, json: async () => data });
describe('campaign step safeguards', () => {
    it('keeps empty and zero budgets invalid and uses the launch ad-account currency', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{ platform: 'GOOGLE', currency: 'AUD', name: 'Ads account' }])));
        function Budget() { const [draft, setDraft] = useState(createInitialDraft); return <><StepBudgetReview draft={draft} setDraft={setDraft} /><output>{validateStep(4, draft).isValid ? 'Valid budget' : 'Invalid budget'}</output></>; }
        render(<Budget />); await screen.findByLabelText('Daily budget (AUD)'); const input = screen.getByRole('spinbutton'); fireEvent.change(input, { target: { value: '' } }); expect(input).toHaveValue(null); expect(screen.getByText('Invalid budget')).toBeInTheDocument();
        fireEvent.change(input, { target: { value: '0' } }); expect(input).toHaveValue(0); expect(screen.getByText('Invalid budget')).toBeInTheDocument(); expect(screen.queryByText(/United States/)).toBeNull();
    });
    it('disables unsupported PMAX and rejects it at launch validation', () => {
        const draft = { ...createInitialDraft(), type: 'PMAX' as const, name: 'Campaign' }; render(<StepGoalType draft={draft} setDraft={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Performance Max/ })).toBeDisabled(); expect(validateStep(1, draft).isValid).toBe(false);
    });
    it('aborts old product reads and retains zero-price products with an honest coverage label', async () => {
        let resolve!: (value: unknown) => void; const fetch = vi.fn().mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(response({ products: [{ wooId: 2, name: 'Free product', price: '0' }] })); vi.stubGlobal('fetch', fetch);
        const props = { draft: createInitialDraft(), setDraft: vi.fn() }; const view = render(<StepProductSelection {...props} />); await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); const signal = fetch.mock.calls[0][1].signal;
        m.account = { id: 'b', currency: 'EUR' }; view.rerender(<StepProductSelection {...props} />); await screen.findByRole('button', { name: /Free product/ }); await act(async () => { resolve(response({ products: [{ wooId: 1, name: 'Old account product', price: 1 }] })); });
        expect(signal.aborted).toBe(true); expect(screen.queryByText(/Old account product/)).toBeNull(); expect(screen.getByText(/Up to 100 matching products/)).toBeInTheDocument();
    });
    it('exposes malformed product responses as retryable errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ products: {} }))); render(<StepProductSelection draft={createInitialDraft()} setDraft={vi.fn()} />); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
});
