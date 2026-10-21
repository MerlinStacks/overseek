import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepAdCopy } from './StepAdCopy';
import { createInitialDraft, MAX_HEADLINE_LENGTH, MAX_DESCRIPTION_LENGTH, type CampaignDraft } from '../types';
import { WizardStepIndicator } from '../WizardStepIndicator';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function Harness({ initial }: { initial: CampaignDraft }) {
    const [draft, setDraft] = useState(initial);
    return <><StepAdCopy draft={draft} setDraft={setDraft} /><output data-testid="draft">{JSON.stringify(draft)}</output></>;
}
const currentDraft = () => JSON.parse(screen.getByTestId('draft').textContent!) as CampaignDraft;
describe('truthful ad copy templates', () => {
    it('does not auto-generate copy or claim to call an AI service', () => {
        vi.useFakeTimers(); const setDraft = vi.fn(); const draft = { ...createInitialDraft(), selectedProducts: [{ id: 'p', name: 'Ring', price: 1 }] };
        render(<StepAdCopy draft={draft} setDraft={setDraft} />); vi.advanceTimersByTime(10000); expect(setDraft).not.toHaveBeenCalled(); expect(screen.getByText(/Templates are not AI-generated/)).toBeInTheDocument(); expect(screen.getByLabelText('Headline 1')).toHaveValue('');
    });
    it('inserts length-valid, claim-free starter copy without inventing a destination', () => {
        const draft = { ...createInitialDraft(), selectedProducts: [{ id: 'p', name: 'Very Long Product Name '.repeat(12), price: 1 }] };
        render(<Harness initial={draft} />); fireEvent.click(screen.getByRole('button', { name: 'Insert starter templates' })); const copy = currentDraft().adCopy;
        expect(copy.headlines).toHaveLength(3); expect(copy.descriptions).toHaveLength(2); expect(copy.headlines.every(value => value.length <= MAX_HEADLINE_LENGTH)).toBe(true); expect(copy.descriptions.every(value => value.length <= MAX_DESCRIPTION_LENGTH)).toBe(true);
        expect(copy.finalUrl).toBe(''); expect(JSON.stringify(copy)).not.toMatch(/example\.com|free shipping|20%|guaranteed/i);
    });
    it('preserves manually entered copy if replacement is declined and previews the real URL', () => {
        vi.stubGlobal('confirm', vi.fn(() => false)); const draft = createInitialDraft(); draft.adCopy = { headlines: ['Manual headline', 'Second', 'Third'], descriptions: ['Manual description', 'Second description'], finalUrl: 'https://shop.test/real-product?variant=1' };
        render(<Harness initial={draft} />); fireEvent.click(screen.getByRole('button', { name: 'Insert starter templates' })); expect(currentDraft().adCopy).toEqual(draft.adCopy); expect(screen.getByText(/Ad preview.*shop.test\/real-product\?variant=1/)).toBeInTheDocument();
    });
    it('does not replace edits or products that changed before the queued state updater runs', () => {
        const setDraft = vi.fn(); const initial = createInitialDraft(); render(<StepAdCopy draft={initial} setDraft={setDraft} />); fireEvent.click(screen.getByRole('button', { name: 'Insert starter templates' }));
        const changed = { ...initial, adCopy: { ...initial.adCopy, headlines: ['New manual draft'] } }; expect(setDraft.mock.calls[0][0](changed)).toBe(changed);
    });
    it('adds and removes optional descriptions with explicit non-submit controls', () => {
        render(<Harness initial={createInitialDraft()} />); fireEvent.click(screen.getByRole('button', { name: '+ Add Description' })); expect(screen.getByLabelText('Description 3')).toBeInTheDocument();
        const remove = screen.getByRole('button', { name: 'Remove description 3' }); expect(remove).toHaveAttribute('type', 'button'); fireEvent.click(remove); expect(screen.queryByLabelText('Description 3')).toBeNull();
    });
});
describe('semantic campaign progress', () => {
    it('names the current step and announces completed steps in text', () => {
        render(<WizardStepIndicator currentStep={3} />); expect(screen.getByRole('list')).toBeInTheDocument(); expect(screen.getAllByText('Completed')).toHaveLength(2);
        expect(screen.getAllByRole('listitem')[2]).toHaveAttribute('aria-current', 'step'); expect(screen.getAllByRole('listitem')[2]).toHaveTextContent('Ad Copy');
    });
    it('does not imply completion for an invalid step', () => { render(<WizardStepIndicator currentStep={NaN} />); expect(screen.getByRole('status')).toHaveTextContent('unavailable'); expect(screen.queryByText('Completed')).toBeNull(); });
});
