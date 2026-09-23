import { useState, forwardRef, useImperativeHandle } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductionRangeFields, type ProductionRangeDraft } from './ProductionRangeFields';
import { validateProductionRange } from '../../utils/productionRange';
import { GeneralInfoPanel } from './GeneralInfoPanel';
import { VariationsPanel } from './VariationsPanel';

const { saveBom } = vi.hoisted(() => ({ saveBom: vi.fn(async () => true) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: null }) }));
vi.mock('../../hooks/useAccountFeature', () => ({ useAccountFeature: () => false }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => false }) }));
vi.mock('../common/RichTextEditor', () => ({ RichTextEditor: () => <div>Description editor</div> }));
vi.mock('./ProductVideoGallery', () => ({ VariantVideoEditor: () => null }));
vi.mock('./BOMPanel', () => ({
    BOMPanel: forwardRef(function MockBOM(_, ref) {
        useImperativeHandle(ref, () => ({ save: saveBom }));
        return <div>BOM editor</div>;
    })
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('production range validation', () => {
    it.each([['', ''], ['0', '0'], ['0', '3650']])('accepts %s to %s', (min, max) => {
        expect(validateProductionRange({ min, max })).toBeNull();
    });
    it.each([['', '2'], ['2', ''], ['3', '2'], ['-1', '2'], ['0', '3651'], ['1.5', '2'], ['1e2', '200'], [' ', '2']])('rejects %s to %s', (min, max) => {
        expect(validateProductionRange({ min, max })).toEqual(expect.any(String));
    });
});

describe('controlled production fields', () => {
    it('reports invalid inheritance and gives simultaneously rendered fields unique labels', () => {
        render(<>
            <ProductionRangeFields label="Parent" value={{ min: '4', max: '2' }} onChange={vi.fn()} />
            <ProductionRangeFields label="Variant" value={{ min: '', max: '' }} inherited={{ min: '4', max: '2' }} onChange={vi.fn()} />
        </>);
        const parent = within(screen.getByRole('group', { name: 'Parent' })).getByLabelText('Minimum days');
        const variant = within(screen.getByRole('group', { name: 'Variant' })).getByLabelText('Minimum days');
        expect(parent.id).not.toBe(variant.id);
        expect(within(screen.getByRole('group', { name: 'Variant' })).getByRole('alert')).toHaveTextContent('Parent production range: Minimum days cannot exceed');
        expect(screen.queryByText(/Inherits product: minimum/)).not.toBeInTheDocument();
    });

    it('passes loading and edit restrictions through the existing variations panel', async () => {
        const onChange = vi.fn();
        const props = { product: { id: 'local', wooId: 10, type: 'variable' }, variants: [{ id: 82, sku: '', price: '', attributes: [] }] };
        const production = { parent: { min: '0', max: '0' }, values: {}, onChange };
        const { rerender } = render(<VariationsPanel {...props} production={{ ...production, loading: true }} />);
        fireEvent.click(screen.getByText('#82').closest('tr')!.querySelector('td')!);
        expect(await screen.findByText('Loading production range…')).toBeInTheDocument();
        expect(screen.getByLabelText('Minimum days')).toBeDisabled();
        rerender(<VariationsPanel {...props} production={{ ...production, values: { 82: { min: '', max: '' } }, disabled: true }} />);
        expect(screen.getByLabelText('Maximum days')).toBeDisabled();
        expect(screen.getByText('Inherits product: minimum 0 days, maximum 0 days.')).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
        rerender(<VariationsPanel {...props} />);
        expect(screen.queryByRole('group', { name: /production range/ })).not.toBeInTheDocument();
    });

    it('keeps supplied strings until the parent updates, and shows validation errors', () => {
        const onChange = vi.fn();
        const { rerender } = render(<ProductionRangeFields label="Range" value={{ min: '0', max: '2' }} onChange={onChange} />);
        fireEvent.change(screen.getByLabelText('Minimum days'), { target: { value: '3' } });
        expect(onChange).toHaveBeenCalledWith({ min: '3', max: '2' });
        expect(screen.getByLabelText('Minimum days')).toHaveValue('0');
        rerender(<ProductionRangeFields label="Range" value={{ min: '3', max: '2' }} onChange={onChange} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Minimum days cannot exceed');
        rerender(<ProductionRangeFields label="Range" value={{ min: '', max: '2' }} onChange={onChange} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Enter both');
    });

    it('allows retrying a failed production load from the expanded variation', async () => {
        const onRetry = vi.fn();
        render(<VariationsPanel product={{ id: 'local', wooId: 10, type: 'variable' }}
            variants={[{ id: 82, sku: '', price: '', attributes: [] }]}
            production={{ parent: { min: '', max: '' }, values: {}, onChange: vi.fn(), error: 'Load failed', onRetry }} />);
        fireEvent.click(screen.getByText('#82').closest('tr')!.querySelector('td')!);
        expect(await screen.findByRole('alert')).toHaveTextContent('Load failed');
        expect(screen.getByLabelText('Minimum days')).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: /Retry loading production range/ }));
        expect(onRetry).toHaveBeenCalledOnce();
        expect(saveBom).not.toHaveBeenCalled();
    });

    it('distinguishes unavailable, loading, errors and disabled drafts from blank values', () => {
        const onChange = vi.fn();
        const onRetry = vi.fn();
        const { rerender } = render(<ProductionRangeFields label="Range" value={undefined} onChange={onChange} />);
        expect(screen.getByText('Production range unavailable.')).toBeInTheDocument();
        expect(screen.getByLabelText('Minimum days')).toBeDisabled();
        rerender(<ProductionRangeFields label="Range" value={undefined} loading onChange={onChange} />);
        expect(screen.getByText('Loading production range…')).toBeInTheDocument();
        expect(screen.getByLabelText('Maximum days')).toBeDisabled();
        rerender(<ProductionRangeFields label="Range" value={undefined} error="Load failed" onRetry={onRetry} onChange={onChange} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Load failed');
        fireEvent.click(screen.getByRole('button', { name: /Retry loading/ }));
        expect(onRetry).toHaveBeenCalledOnce();
        rerender(<ProductionRangeFields label="Range" value={{ min: '0', max: '0' }} disabled onChange={onChange} />);
        expect(screen.getByLabelText('Minimum days')).toHaveValue('0');
        expect(screen.getByLabelText('Minimum days')).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Minimum days'), { target: { value: '2' } });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('places parent fields in the normal general card with a controlled callback', () => {
        const ordinaryChange = vi.fn();
        function Editor() {
            const [value, onChange] = useState<ProductionRangeDraft>({ min: '', max: '' });
            return <GeneralInfoPanel formData={{ name: 'Product', sku: 'SKU' }} product={{ wooId: 100 }} onChange={ordinaryChange} production={{ value, onChange }} />;
        }
        render(<Editor />);
        const group = screen.getByRole('group', { name: 'Product production range' });
        expect(group.parentElement?.parentElement).toContainElement(screen.getByText('General Information'));
        fireEvent.change(within(group).getByLabelText('Minimum days'), { target: { value: '0' } });
        fireEvent.change(within(group).getByLabelText('Maximum days'), { target: { value: '0' } });
        expect(within(group).getByLabelText('Minimum days')).toHaveValue('0');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(ordinaryChange).not.toHaveBeenCalled();
        expect(screen.queryByRole('tab')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    });

    it('uses actual Woo IDs in expanded rows, inherits live zero values and never sends production through ordinary variant or BOM updates', async () => {
        const ordinaryChange = vi.fn();
        const productionChange = vi.fn();
        const variants = [{ id: 731, sku: 'A', price: '10', attributes: [] }, { id: 945, sku: 'B', price: '20', attributes: [] }];
        function Editor() {
            const [parent, setParent] = useState({ min: '2', max: '4' });
            const [values, setValues] = useState<Record<number, ProductionRangeDraft>>({ 731: { min: '', max: '' }, 945: { min: '', max: '' } });
            return <>
                <button onClick={() => setParent({ min: '0', max: '0' })}>Update parent</button>
                <VariationsPanel product={{ id: 'local-id', wooId: 100, type: 'variable', variations: [731, 945] }} variants={variants} onUpdate={ordinaryChange}
                    production={{ parent, values, onChange: (id, value) => { productionChange(id, value); setValues(previous => ({ ...previous, [id]: value })); } }} />
            </>;
        }
        render(<Editor />);
        const expand = (id: number) => fireEvent.click(screen.getByText(`#${id}`).closest('tr')!.querySelector('td')!);
        expand(945);
        const group = await screen.findByRole('group', { name: 'Variant #945 production range' });
        expect(group.closest('tbody')).not.toBeNull();
        expect(screen.getByText('Inherits product: minimum 2 days, maximum 4 days.')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Update parent'));
        expect(screen.getByText('Inherits product: minimum 0 days, maximum 0 days.')).toBeInTheDocument();
        fireEvent.change(within(group).getByLabelText('Minimum days'), { target: { value: '0' } });
        fireEvent.change(within(group).getByLabelText('Maximum days'), { target: { value: '3' } });
        expect(productionChange).toHaveBeenLastCalledWith(945, { min: '0', max: '3' });
        expect(ordinaryChange).not.toHaveBeenCalled();
        expect(saveBom).not.toHaveBeenCalled();
        expand(731);
        await screen.findByRole('group', { name: 'Variant #731 production range' });
        expand(945);
        const reopened = await screen.findByRole('group', { name: 'Variant #945 production range' });
        expect(within(reopened).getByLabelText('Maximum days')).toHaveValue('3');
        expect(ordinaryChange).not.toHaveBeenCalled();
    });
});
