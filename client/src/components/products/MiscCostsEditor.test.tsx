import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MiscCostsEditor, type MiscCost } from './MiscCostsEditor';
afterEach(cleanup);
describe('miscellaneous costs editor', () => {
    it('emits zero rather than NaN when an amount is cleared', () => {
        const change = vi.fn(); render(<MiscCostsEditor value={[{ amount: 12, note: 'Freight' }]} onChange={change} />);
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Cost 1 amount' }), { target: { value: '' } });
        expect(change).toHaveBeenCalledWith([{ amount: 0, note: 'Freight' }]);
    });
    it('preserves decimal and negative amounts and updates descriptions immutably', () => {
        const value = [{ amount: 12, note: 'Freight' }]; const change = vi.fn();
        render(<MiscCostsEditor value={value} onChange={change} />);
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-2.35' } });
        expect(change).toHaveBeenLastCalledWith([{ amount: -2.35, note: 'Freight' }]);
        fireEvent.change(screen.getByRole('textbox', { name: 'Cost 1 description' }), { target: { value: 'Shipping' } });
        expect(change).toHaveBeenLastCalledWith([{ amount: 12, note: 'Shipping' }]);
        expect(value).toEqual([{ amount: 12, note: 'Freight' }]);
    });
    it('adds and removes costs without submitting a surrounding form', () => {
        const submit = vi.fn(event => event.preventDefault());
        function Editor() {
            const [costs, setCosts] = useState<MiscCost[]>([{ amount: 5, note: 'Freight' }]);
            return <form onSubmit={submit}><MiscCostsEditor value={costs} onChange={setCosts} /></form>;
        }
        render(<Editor />);
        fireEvent.click(screen.getByRole('button', { name: 'Add Cost' }));
        expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Remove cost 1' }));
        expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
        expect(screen.getByText('Total: $0.00')).toBeInTheDocument();
        expect(submit).not.toHaveBeenCalled();
    });
    it('does not display non-finite stored amounts or totals', () => {
        render(<MiscCostsEditor value={[{ amount: Infinity, note: 'Invalid' }]} onChange={vi.fn()} />);
        expect(screen.getByRole('spinbutton')).toHaveValue(null);
        expect(screen.getByText('Total: $0.00')).toBeInTheDocument();
    });
});
