import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentBuilder } from './SegmentBuilder';

describe('Ecommerce segment builder', () => {
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
});
