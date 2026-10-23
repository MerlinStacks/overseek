import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductTagPicker } from './ProductTagPicker';
import { CONDITION_GROUPS, ConditionConfig } from './ConditionConfig';

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'a' } }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('WooCommerce product tag conditions', () => {
    it('offers both order and purchase history conditions', () => {
        const fields = CONDITION_GROUPS.flatMap(group => group.conditions).map(condition => condition.field);
        expect(fields).toContain('order.productTagId');
        expect(fields).toContain('customer.purchasedProductTagIds');
        const tagConditions = CONDITION_GROUPS.flatMap(group => group.conditions).filter(condition => ['order.productTagId', 'customer.purchasedProductTagIds'].includes(condition.field));
        tagConditions.forEach(condition => expect(condition.operators).toEqual(['contains', 'contains_any', 'not_contains']));
    });
    it('offers the requested operators with a single searchable multi-select field', () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }));
        const update = vi.fn();
        render(<ConditionConfig config={{ conditions: [{ field: 'order.productTagId', operator: 'contains', value: '94,95' }] }} onUpdate={update} />);
        expect(screen.getAllByRole('combobox')).toHaveLength(2);
        expect(screen.getByRole('option', { name: 'contains any of' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'does not contain' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Condition operator'), { target: { value: 'contains_any' } });
        expect(update).toHaveBeenCalledWith('conditions', [{ field: 'order.productTagId', operator: 'contains_any', value: '94,95' }]);
    });
    it('searches WooCommerce tags server-side, pages and saves the tag ID', async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: 94, name: '9ct' }], totalPages: 2 }) });
        vi.stubGlobal('fetch', fetch);
        const change = vi.fn();
        render(<ProductTagPicker value="" onChange={change} />);
        fireEvent.focus(screen.getByRole('combobox'));
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '9ct' } });
        await waitFor(() => expect(screen.getByRole('option', { name: '9ct' })).toBeInTheDocument(), { timeout: 5000 });
        expect(fetch).toHaveBeenLastCalledWith('/api/products/tags?limit=50&page=1&q=9ct', expect.objectContaining({ headers: { Authorization: 'Bearer token', 'X-Account-ID': 'a' } }));
        fireEvent.click(screen.getByRole('option', { name: '9ct' }));
        expect(change).toHaveBeenCalledWith('94');
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/products/tags?limit=50&page=2&q=9ct', expect.anything()), { timeout: 5000 });
    });
    it('shows taxonomy fetch errors rather than silently giving an empty list', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        render(<ProductTagPicker value="94" onChange={vi.fn()} />);
        fireEvent.focus(screen.getByRole('combobox'));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load WooCommerce tags'), { timeout: 5000 });
        expect(screen.getByText('Tag #94')).toBeInTheDocument();
    });
    it('selects multiple tags, preserves names across searches, and removes selected tags', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => ({ items: url.includes('q=Gold') ? [{ id: 95, name: 'Gold' }] : [{ id: 94, name: '9ct' }], totalPages: 1 }) })));
        const change = vi.fn();
        const { rerender } = render(<ProductTagPicker value="94" onChange={change} />);
        fireEvent.focus(screen.getByRole('combobox'));
        await screen.findByRole('option', { name: '9ct' });
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Gold' } });
        await screen.findByRole('option', { name: 'Gold' });
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
        expect(change).toHaveBeenLastCalledWith('94,95');
        rerender(<ProductTagPicker value="94,95" onChange={change} />);
        expect(screen.getByRole('button', { name: 'Remove 9ct' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Gold' }));
        expect(change).toHaveBeenLastCalledWith('94');
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
        expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
});
