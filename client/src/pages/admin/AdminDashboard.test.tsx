import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'admin-token', user: { id: 'admin', isSuperAdmin: true } }) }));
vi.mock('../../services/api', () => ({ api: { request: mocks.request } }));
import { AdminDashboard } from './AdminDashboard';

const health = {
    status: 'degraded', timestamp: '2026-11-05T10:00:00Z',
    version: { app: '1.0.0', node: '22', uptime: 3600, uptimeFormatted: '1h' },
    services: { database: { status: 'healthy', latencyMs: 0 }, elasticsearch: { status: 'degraded', latencyMs: 3, details: 'Cluster: docker-cluster, Nodes: 1' } },
    queues: {
        orders: { waiting: 0, active: 0, completed: 0, failed: 2 },
        automations: { waiting: 3539, active: 1, completed: 1382, failed: 1 },
        scheduler: { waiting: 11, active: 1, completed: 106, failed: 19 },
        wholesale_catalog_generate: { waiting: 0, active: 0, completed: 0, failed: 0 },
    },
    webhooks: { received24h: 12, processed24h: 10, failed24h: 2 },
    sync: { totalAccounts: 2, entityTypes: [] },
};

beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockImplementation(async url => url.endsWith('/stats')
        ? { totalAccounts: 2, totalUsers: 9, activeSyncs: 50, failedSyncs24h: 0 } : health);
});
afterEach(cleanup);

describe('admin overview', () => {
    it('surfaces degraded health and orders queues by failures', async () => {
        render(<AdminDashboard />);
        const table = await screen.findByRole('table');
        expect(screen.getByText(/System performance is degraded/)).toBeInTheDocument();
        expect(screen.getByText('0 ms')).toBeInTheDocument();
        expect(screen.getByText('Cluster: docker-cluster, Nodes: 1')).toBeInTheDocument();
        const rows = within(table).getAllByRole('row');
        expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('scheduler');
        expect(within(rows[2]).getByRole('rowheader')).toHaveTextContent('orders');
        expect(within(screen.getByRole('region', { name: 'Webhooks' })).getByText('12')).toBeInTheDocument();
    });

    it('combines queue search and filters without changing totals', async () => {
        render(<AdminDashboard />);
        await screen.findByRole('table');
        fireEvent.change(screen.getByRole('combobox', { name: 'Filter queues' }), { target: { value: 'busy' } });
        expect(screen.getByText('Showing 2 of 4 queues')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', { name: 'Search queues' }), { target: { value: 'AUTO' } });
        expect(screen.getByText('Showing 1 of 4 queues')).toBeInTheDocument();
        expect(screen.getByText((3539 + 11).toLocaleString())).toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', { name: 'Search queues' }), { target: { value: 'missing' } });
        expect(screen.getByText('No queues match your filters.')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', { name: 'Filter queues' }), { target: { value: 'all' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Search queues' }), { target: { value: 'wholesale_catalog' } });
        expect(screen.getByRole('rowheader', { name: 'wholesale catalog generate' })).toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', { name: 'Search queues' }), { target: { value: '' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Filter queues' }), { target: { value: 'failed' } });
        expect(screen.getByText('Showing 3 of 4 queues')).toBeInTheDocument();
    });

    it('keeps health failures distinct from empty queues or zero webhook counts', async () => {
        mocks.request.mockImplementation(async url => { if (url.endsWith('/system-health')) throw new Error('Offline'); return { totalAccounts: 2, totalUsers: 9, activeSyncs: 50, failedSyncs24h: 0 }; });
        render(<AdminDashboard />);
        await screen.findByRole('alert');
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        expect(screen.getByText('Webhook data unavailable.')).toBeInTheDocument();
        expect(screen.getByText('Queue data is unavailable until system health loads.')).toBeInTheDocument();
    });
});
