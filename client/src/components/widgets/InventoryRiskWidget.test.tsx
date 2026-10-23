import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryRiskWidget } from './InventoryRiskWidget';
import { ROUTE_PATHS } from '../../utils/routeTitles';

const account = { id: 'account-1' };
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: account }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../hooks/useWidgetSocket', () => ({ useWidgetSocket: vi.fn() }));
vi.mock('../../hooks/useVisibilityPolling', async () => {
    const { useEffect } = await import('react');
    return {
        useVisibilityPolling: (callback: () => Promise<void>) => {
            useEffect(() => { void callback(); }, [callback]);
        }
    };
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('InventoryRiskWidget navigation', () => {
    it('opens inventory forecasts within the app when View All Risks is clicked', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                critical: [{ id: 'product-1', wooId: 1, name: 'Low stock product', currentStock: 0, dailyDemand: 1, daysUntilStockout: 0 }],
                high: []
            })
        }));

        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <Routes>
                    <Route path="/dashboard" element={<InventoryRiskWidget dateRange={{ startDate: '2026-10-01', endDate: '2026-10-23' }} />} />
                    <Route path={ROUTE_PATHS.inventoryForecasts} element={<h1>Inventory Forecasts</h1>} />
                </Routes>
            </MemoryRouter>
        );

        const link = await screen.findByRole('link', { name: 'View All Risks' });
        expect(link).toHaveAttribute('href', '/inventory/forecasts');
        fireEvent.click(link);
        expect(await screen.findByRole('heading', { name: 'Inventory Forecasts' })).toBeInTheDocument();
    });
});
