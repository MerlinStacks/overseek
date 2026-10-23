import { createRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', currency: 'EUR' }, token: 'token' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: m.token }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
import { BOMPanel, type BOMPanelRef } from './BOMPanel';
import { BOMItemsTable, type BOMItem } from './bom/BOMItemsTable';
import { BOMCostSummary } from './bom/BOMCostSummary';
import { BOMSearchDropdown } from './bom/BOMSearchDropdown';
import { parseVariantStock } from './variantTypes';
import { VariantTableRow } from './VariantTableRow';

beforeEach(() => { m.account = { id: 'a', currency: 'EUR' }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const item: BOMItem = { id: 'item', childProductId: 'child', displayName: 'Component', quantity: 2, wasteFactor: .05, cost: 10 };
const bom = { items: [{ id: 'item', childProductId: 'child', quantity: '2', wasteFactor: '0.05', childProduct: { name: 'Component', cogs: '10' } }] };
const response = (value: unknown, ok = true) => ({ ok, json: async () => value });
describe('BOM values and controls', () => {
    it('converts percentages to fractions without mutating the supplied item', () => {
        const change = vi.fn(); const original = Object.freeze({ ...item });
        render(<BOMItemsTable items={[original]} selectedScope={0} currency="EUR" onItemsChange={change} />);
        expect(screen.getByRole('spinbutton', { name: /Waste percentage/ })).toHaveValue(5);
        fireEvent.change(screen.getByRole('spinbutton', { name: /Waste percentage/ }), { target: { value: '10' } });
        expect(change.mock.calls[0][0][0].wasteFactor).toBe(.1); expect(original.wasteFactor).toBe(.05);
        expect(change.mock.calls[0][0][0]).not.toBe(original);
    });
    it('retains a blank quantity as invalid rather than converting it to zero', () => {
        function Table() { const [items, setItems] = useState([item]); return <><BOMItemsTable items={items} selectedScope={0} currency="EUR" onItemsChange={setItems} /><output>{Number.isNaN(items[0].quantity) ? 'Invalid quantity' : 'Valid'}</output></>; }
        render(<Table />); fireEvent.change(screen.getByRole('spinbutton', { name: /Quantity/ }), { target: { value: '' } });
        expect(screen.getByRole('spinbutton', { name: /Quantity/ })).toHaveValue(null); expect(screen.getByText('Invalid quantity')).toBeInTheDocument(); expect(screen.getByText('Unavailable')).toBeInTheDocument();
    });
    it('does not call unknown Woo stock out of sync or format malformed costs', () => {
        render(<BOMCostSummary totalCost={NaN} effectiveStock={0} currentWooStock={null} currency="EUR" isSyncing={false} syncStatus="idle" onSyncToWoo={vi.fn()} />);
        expect(screen.getByText('Stock comparison unavailable')).toBeInTheDocument(); expect(screen.queryByText('Out of sync')).toBeNull(); expect(screen.getAllByText('Unavailable')).toHaveLength(2); expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
        expect(screen.getByLabelText('BOM summary')).toHaveClass('metric-strip');
        expect(screen.getByText('Buildable units').nextElementSibling).toHaveTextContent('0');
    });
    it('keeps the stock sync action outside the slim summary and respects its disabled state', () => {
        const sync = vi.fn();
        const view = render(<BOMCostSummary totalCost={5} effectiveStock={3} currentWooStock={2} isSyncing={false} syncStatus="idle" onSyncToWoo={sync} disabled />);
        expect(screen.getByText('Out of sync')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sync to WooCommerce' })).toBeDisabled();
        expect(screen.getByLabelText('BOM summary')).not.toContainElement(screen.getByRole('button'));
        view.rerender(<BOMCostSummary totalCost={5} effectiveStock={3} currentWooStock={2} isSyncing={false} syncStatus="idle" onSyncToWoo={sync} />);
        fireEvent.click(screen.getByRole('button', { name: 'Sync to WooCommerce' }));
        expect(sync).toHaveBeenCalledOnce();
    });
    it('preserves zero COGS, accepts numeric strings and never uses selling price as a cost', () => {
        render(<BOMSearchDropdown searchTerm="part" onSearchChange={vi.fn()} productId="parent" onAddProduct={vi.fn()} currency="EUR" searchResults={[{ id: 'zero', name: 'Zero cost', cogs: 0, price: 99 }, { id: 'unknown', name: 'Unknown cost', price: 99 }, { id: 'variants', name: 'Variants', searchableVariants: [{ wooId: 1, cogs: '2.50' as unknown as number }] }]} />);
        expect(screen.getByRole('button', { name: /Zero cost/ })).toHaveTextContent(/EUR.*0/); expect(screen.getByRole('button', { name: /Unknown cost/ })).toHaveTextContent('COGS: Unavailable'); expect(screen.getByRole('button', { name: /Variant #1/ })).toHaveTextContent(/EUR.*2.50/);
        expect(screen.queryByText(/99/)).toBeNull();
    });
});
describe('BOM integration guards', () => {
    it('blocks imperative saves on failed reads and supports retry', async () => {
        const fetch = vi.fn().mockResolvedValueOnce(response({}, false)).mockResolvedValue(response({ items: [] })); vi.stubGlobal('fetch', fetch); const ref = createRef<BOMPanelRef>();
        render(<BOMPanel productId="parent" ref={ref} />); await screen.findByRole('alert'); expect(await ref.current!.save()).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true })); await screen.findByText(/No BOM items configured/); expect(await ref.current!.save()).toBe(true);
    });
    it('aborts old-account reads and does not expose their late components', async () => {
        let resolve!: (value: unknown) => void; const fetch = vi.fn().mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(response({ items: [] })); vi.stubGlobal('fetch', fetch);
        const view = render(<BOMPanel productId="parent" />); await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); const signal = fetch.mock.calls[0][1].signal;
        m.account = { id: 'b', currency: 'EUR' }; view.rerender(<BOMPanel productId="parent" />);
        await act(async () => { resolve(response(bom)); }); await screen.findByText(/No BOM items configured/); expect(signal.aborted).toBe(true); expect(screen.queryByRole('button', { name: 'Remove Component' })).toBeNull();
    });
    it('serializes saves, locks edits, and permits explicitly saving a removed final item', async () => {
        let resolve!: (value: unknown) => void; const fetch = vi.fn((url: string, options?: RequestInit) => options?.method === 'POST' ? new Promise(r => { resolve = r; }) : Promise.resolve(response(url.includes('effective-stock') ? { effectiveStock: 4, currentWooStock: 4 } : bom))); vi.stubGlobal('fetch', fetch);
        const ref = createRef<BOMPanelRef>(); const update = vi.fn(); render(<BOMPanel productId="parent" ref={ref} onCOGSUpdate={update} />);
        await screen.findByRole('button', { name: 'Remove Component' }); fireEvent.click(screen.getByRole('button', { name: 'Remove Component' }));
        let save!: Promise<boolean>; await act(async () => { save = ref.current!.save(); }); expect(await ref.current!.save()).toBe(false);
        expect(screen.getByRole('textbox', { name: 'Search components' })).toBeDisabled();
        const posts = fetch.mock.calls.filter(call => call[1]?.method === 'POST'); expect(posts).toHaveLength(1); expect(JSON.parse(posts[0][1]!.body as string).items).toEqual([]);
        await act(async () => { resolve(response({ items: [] })); await save; }); expect(await save).toBe(true); expect(update).toHaveBeenCalledWith(0, false);
    });
    it('reports unknown component costs as unknown while preserving BOM presence after save', async () => {
        const unknown = { items: [{ ...bom.items[0], childProduct: { name: 'Component', cogs: null } }] };
        vi.stubGlobal('fetch', vi.fn((url: string, options?: RequestInit) => Promise.resolve(response(url.includes('effective-stock') ? { effectiveStock: null, currentWooStock: null } : options?.method === 'POST' ? { items: [{ ...unknown.items[0], quantity: '3' }] } : unknown))));
        const ref = createRef<BOMPanelRef>(); const update = vi.fn(); render(<BOMPanel productId="parent" ref={ref} onCOGSUpdate={update} />);
        await screen.findByRole('button', { name: 'Remove Component' }); fireEvent.change(screen.getByRole('spinbutton', { name: /Quantity/ }), { target: { value: '3' } });
        await act(async () => { expect(await ref.current!.save()).toBe(true); }); expect(update).toHaveBeenCalledWith(null, true); expect(screen.queryByText(/EUR.*0.00/)).toBeNull();
    });
});
describe('strict variant stock', () => {
    it.each(['', '1.5', '2x', '-1', 'Infinity', '9007199254740992'])('rejects %j without truncating', value => { expect(parseVariantStock(value)).toBeNull(); });
    it('uses keyboard-accessible expansion and locks controls during saves', () => {
        const expand = vi.fn(); render(<table><tbody><VariantTableRow variant={{ id: 1, sku: '', price: '1', attributes: [], manageStock: true }} isExpanded={false} onToggleExpand={expand} onFieldChange={vi.fn()} stockEditValue="1.5" onStockEditChange={vi.fn()} onStockAdjust={vi.fn()} onStockSave={vi.fn()} isSavingStock={false} currency="EUR" /></tbody></table>);
        fireEvent.click(screen.getByRole('button', { name: 'Expand variant 1' })); expect(expand).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: 'Save stock for variant 1' })).toBeDisabled(); expect(screen.getByRole('textbox', { name: 'Stock for variant 1' })).toHaveValue('1.5');
    });
});
