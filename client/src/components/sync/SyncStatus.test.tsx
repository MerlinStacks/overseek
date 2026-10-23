import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncStatus } from './SyncStatus';

const mock = vi.hoisted(() => ({ runSync: vi.fn(), refreshStatus: vi.fn() }));
vi.mock('../../context/SyncStatusContext', () => ({
    useSyncStatus: () => ({
        isSyncing: false, syncState: [], logs: [], activeJobs: [], healthSummary: null,
        schedules: [], canManageSchedules: false, ...mock,
    }),
}));

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('sync workspace controls', () => {
    it('uses brand action tokens and keeps refresh independently accessible', () => {
        render(<SyncStatus />);
        expect(screen.getByRole('button', { name: 'Sync Now' })).toHaveClass('bg-[var(--primary-color)]', 'text-[var(--primary-foreground)]');
        fireEvent.click(screen.getByRole('button', { name: 'Refresh sync status' }));
        expect(mock.refreshStatus).toHaveBeenCalledOnce();
        expect(mock.runSync).not.toHaveBeenCalled();
    });

    it('exposes the selected activity filter without relying on colour', () => {
        render(<SyncStatus />);
        expect(screen.getByRole('button', { name: 'All', pressed: true })).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Products', pressed: false }));
        expect(screen.getByRole('button', { name: 'Products', pressed: true })).toHaveClass('bg-[var(--brand-subtle)]');
        expect(screen.getByRole('button', { name: 'All', pressed: false })).toBeVisible();
        expect(mock.runSync).not.toHaveBeenCalled();
    });
});
