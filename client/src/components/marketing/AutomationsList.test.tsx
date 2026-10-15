import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationsList } from './AutomationsList';

const account = { id: 'account-1' };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: account }) }));

const flow = {
    id: 'flow-1', name: 'Abandoned Cart', isActive: true, triggerType: 'ABANDONED_CART',
    enrollments: [{}],
    metrics: { activeInFlow: 0, pausedInFlow: 0, completedInFlow: 12, failedInFlow: 0, revenue: 125.5 }
};
const response = (data: unknown) => ({ ok: true, json: async () => data });

describe('Flow revenue and reporting period', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => response([flow])));
    });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

    it('shows attributed revenue and defaults to all time', async () => {
        render(<AutomationsList onEdit={vi.fn()} />);
        expect(await screen.findByText('$125.50')).toBeInTheDocument();
        expect(screen.getByLabelText('Time period')).toHaveValue('all');
        expect(screen.getByLabelText('Active in flow: 0')).toBeInTheDocument();
        expect(fetch).toHaveBeenCalledWith('/api/marketing/automations', expect.objectContaining({
            headers: { Authorization: 'Bearer token', 'x-account-id': 'account-1' }
        }));
    });

    it('refreshes metrics for the selected period and can return to all time', async () => {
        render(<AutomationsList onEdit={vi.fn()} />);
        await screen.findByText('$125.50');
        vi.mocked(fetch).mockResolvedValueOnce(response([{ ...flow, metrics: { ...flow.metrics, revenue: 25 } }]) as Response);
        fireEvent.change(screen.getByLabelText('Time period'), { target: { value: '30' } });
        expect(await screen.findByText('$25.00')).toBeInTheDocument();
        expect(fetch).toHaveBeenLastCalledWith('/api/marketing/automations?days=30', expect.anything());
        fireEvent.change(screen.getByLabelText('Time period'), { target: { value: 'all' } });
        await screen.findByText('$125.50');
        expect(fetch).toHaveBeenLastCalledWith('/api/marketing/automations', expect.anything());
    });

    it('ignores late responses from a previous period', async () => {
        let resolveOld!: (value: unknown) => void;
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.endsWith('days=7')) return response([{ ...flow, metrics: { ...flow.metrics, revenue: 7 } }]);
            return { ok: true, json: () => new Promise(resolve => { resolveOld = resolve; }) };
        }));
        render(<AutomationsList onEdit={vi.fn()} />);
        await waitFor(() => expect(resolveOld).toBeDefined());
        fireEvent.change(screen.getByLabelText('Time period'), { target: { value: '7' } });
        await screen.findByText('$7.00');
        await act(async () => { resolveOld([flow]); });
        expect(screen.queryByText('$125.50')).not.toBeInTheDocument();
        expect(screen.getByText('$7.00')).toBeInTheDocument();
    });
});
