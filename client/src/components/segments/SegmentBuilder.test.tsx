import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentBuilder } from './SegmentBuilder';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'tenant' } }) }));

describe('Ecommerce segment builder', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keeps guidance collapsed instead of showing a large preset panel', () => {
        render(<SegmentBuilder onSave={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByText('How audience rules work').closest('details')).not.toHaveAttribute('open');
        expect(screen.queryByText('Ecommerce advertising presets')).not.toBeInTheDocument();
    });

    it.each(['product', 'category'] as const)('searches and saves a %s purchase exclusion with an optional window', async kind => {
        const save = vi.fn();
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => kind === 'product' ? { products: [{ id: 'uuid', wooId: 42, name: 'Custom mug' }] } : { items: [{ id: 42, name: 'Mugs' }] } });
        vi.stubGlobal('fetch', fetchMock);
        render(<SegmentBuilder onSave={save} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add Condition' }));
        fireEvent.change(screen.getByLabelText('Condition 1 field'), { target: { value: kind === 'product' ? 'purchasedProduct' : 'purchasedCategory' } });
        expect(screen.getByRole('button', { name: 'Save Segment' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText(`Search ${kind}`), { target: { value: 'mug' } });
        fireEvent.click(await screen.findByRole('button', { name: /(?:Custom mug|Mugs) #42/ }));
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('q=mug'), expect.objectContaining({ headers: { Authorization: 'Bearer token', 'X-Account-ID': 'tenant' } }));
        fireEvent.change(screen.getByLabelText('Condition 1 operator'), { target: { value: 'notPurchased' } });
        fireEvent.change(screen.getByLabelText('Condition 1 purchase window'), { target: { value: '30' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Segment' }));
        expect(save).toHaveBeenCalledWith({ type: 'AND', rules: [{ field: kind === 'product' ? 'purchasedProduct' : 'purchasedCategory', operator: 'notPurchased', value: '42', valueLabel: kind === 'product' ? 'Custom mug' : 'Mugs', withinDays: '30' }] });
        fireEvent.change(screen.getByLabelText('Condition 1 purchase window'), { target: { value: '0' } });
        expect(screen.getByRole('button', { name: 'Save Segment' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Condition 1 field'), { target: { value: 'totalSpent' } });
        fireEvent.change(screen.getByLabelText('Condition 1 value'), { target: { value: '100' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Segment' }));
        expect(save).toHaveBeenLastCalledWith({ type: 'AND', rules: [{ field: 'totalSpent', operator: 'gt', value: '100' }] });
    });
    it('creates an editable rolling purchase segment from a preset', () => {
        const save = vi.fn();
        render(<SegmentBuilder onSave={save} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Recent purchasers' }));
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '14' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Segment' }));
        expect(save).toHaveBeenCalledWith({ type: 'AND', rules: [{ field: 'purchasedWithinDays', operator: 'within', value: '14' }] });
    });

    it('disables saving invalid day windows', () => {
        render(<SegmentBuilder onSave={vi.fn()} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Abandoned carts' }));
        for (const value of ['0', '1.5', '3651', '']) {
            fireEvent.change(screen.getByRole('spinbutton'), { target: { value } });
            expect(screen.getByRole('button', { name: 'Save Segment' })).toBeDisabled();
        }
    });

    it('combines purchase exclusion with past orders for win-back audiences', () => {
        const save = vi.fn();
        render(<SegmentBuilder onSave={save} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Win-back customers' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save Segment' }));
        expect(save).toHaveBeenCalledWith({ type: 'AND', rules: [
            { field: 'ordersCount', operator: 'gte', value: '1' },
            { field: 'notPurchasedWithinDays', operator: 'within', value: '90' }
        ] });
    });

    it('saves email engagement with a rolling window, source ID and purchase exclusion', () => {
        const save = vi.fn();
        render(<SegmentBuilder onSave={save} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Email clickers, no purchase' }));
        fireEvent.change(screen.getByLabelText('Email source ID'), { target: { value: 'campaign-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Segment' }));
        expect(save).toHaveBeenCalledWith({ type: 'AND', rules: [
            { field: 'emailClickedWithinDays', operator: 'within', value: '30', campaignId: 'campaign-1' },
            { field: 'notPurchasedWithinDays', operator: 'within', value: '30' },
        ] });
    });
});
