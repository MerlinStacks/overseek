// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VariationsPanel } from './VariationsPanel';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: null }) }));
vi.mock('../../hooks/useAccountFeature', () => ({ useAccountFeature: () => false }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => false }) }));
vi.mock('./BOMPanel', () => ({ BOMPanel: () => null }));
vi.mock('./ProductVideoGallery', () => ({ VariantVideoEditor: () => null }));

afterEach(cleanup);
const suppliers = [{ id: 'parent', name: 'Parent Supply' }, { id: 'override', name: 'Variant Supply' }];
const variant = { id: 101, sku: 'SKU', price: '10', attributes: [], supplierId: null };
const props = { product: { id: 'product', wooId: 10, type: 'variable' }, variants: [variant], suppliers, parentSupplierId: 'parent' };
const expand = () => fireEvent.click(screen.getByText('#101').closest('tr')!.querySelector('td')!);

describe('variant suppliers', () => {
    it('shows inheritance, selects an override, and explicitly clears it to null', () => {
        const onUpdate = vi.fn();
        render(<VariationsPanel {...props} onUpdate={onUpdate} />);
        expand();
        const select = screen.getByRole('combobox', { name: 'Supplier' }) as HTMLSelectElement;
        expect(select.value).toBe('');
        expect(screen.getByRole('option', { name: 'Use parent supplier (Parent Supply)' })).toBeTruthy();
        expect(onUpdate).not.toHaveBeenCalled();
        fireEvent.change(select, { target: { value: 'override' } });
        expect(onUpdate).toHaveBeenLastCalledWith([{ ...variant, supplierId: 'override' }]);
        fireEvent.change(select, { target: { value: '' } });
        expect(onUpdate).toHaveBeenLastCalledWith([variant]);
    });

    it('tracks parent changes in the label without replacing an explicit override', () => {
        const variants = [{ ...variant, supplierId: 'override' }];
        const { rerender } = render(<VariationsPanel {...props} variants={variants} />);
        expand();
        rerender(<VariationsPanel {...props} variants={variants} parentSupplierId="override" />);
        expect(screen.getByRole('option', { name: 'Use parent supplier (Variant Supply)' })).toBeTruthy();
        expect((screen.getByRole('combobox', { name: 'Supplier' }) as HTMLSelectElement).value).toBe('override');
        rerender(<VariationsPanel {...props} variants={variants} parentSupplierId="" suppliers={[]} />);
        expect(screen.getByRole('option', { name: 'Use parent supplier' })).toBeTruthy();
        expect((screen.getByRole('combobox', { name: 'Supplier' }) as HTMLSelectElement).value).toBe('override');
    });
});
