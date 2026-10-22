import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'a' } }) }));
import { StockManagementPanel } from './StockManagementPanel';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows independent BOM variant capacities without hiding or enabling edits for derived rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ stockQuantity: null, isVariable: true, isBOMBased: true, manageStock: true, variants: [{ wooId: 10, attributes: 'Red', stockQuantity: 2, manageStock: true, isBOMBased: true }, { wooId: 11, attributes: 'Blue', stockQuantity: 4, manageStock: true, isBOMBased: false }] }) })));
    render(<StockManagementPanel productWooId={1} />); expect(await screen.findByText(/Red stock: 2/)).toHaveTextContent('read-only'); expect(screen.queryByRole('spinbutton', { name: 'Red stock' })).not.toBeInTheDocument(); expect(screen.getByRole('spinbutton', { name: 'Blue stock' })).toHaveValue(4); expect(screen.getByText(/total capacity is unavailable/)).toBeInTheDocument();
});
