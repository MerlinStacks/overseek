import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WizardStepProps } from './types';
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account' } }) }));
vi.mock('./steps/StepGoalType', () => ({ StepGoalType: ({ setDraft }: WizardStepProps) => <button onClick={() => setDraft(draft => ({ ...draft, name: 'Campaign' }))}>Set name</button> }));
vi.mock('./steps/StepProductSelection', () => ({ StepProductSelection: () => <p>Optional products</p> }));
vi.mock('./steps/StepAdCopy', () => ({ StepAdCopy: ({ setDraft }: WizardStepProps) => <button onClick={() => setDraft(draft => ({ ...draft, adCopy: { headlines: ['One', 'Two', 'Three'], descriptions: ['First', 'Second'], finalUrl: 'https://example.com' } }))}>Set copy</button> }));
vi.mock('./steps/StepBudgetReview', () => ({ StepBudgetReview: ({ setDraft }: WizardStepProps) => <button onClick={() => setDraft(draft => ({ ...draft, adCopy: { ...draft.adCopy, finalUrl: 'javascript:alert(1)' } }))}>Invalidate URL</button> }));
import { CampaignWizard } from './CampaignWizard';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('campaign launch validation', () => {
    it('rechecks earlier steps at launch and returns to the invalid step without posting', () => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        render(<CampaignWizard isOpen onClose={vi.fn()} />);
        fireEvent.click(screen.getByText('Set name'));
        fireEvent.click(screen.getByText('Next Step'));
        fireEvent.click(screen.getByText('Next Step'));
        fireEvent.click(screen.getByText('Set copy'));
        fireEvent.click(screen.getByText('Next Step'));
        fireEvent.click(screen.getByText('Invalidate URL'));
        fireEvent.click(screen.getByText('Launch Campaign'));
        expect(fetch).not.toHaveBeenCalled();
        expect(screen.getByText('Set copy')).toBeInTheDocument();
        expect(screen.getByText(/Final URL must be/)).toBeInTheDocument();
    });
});
