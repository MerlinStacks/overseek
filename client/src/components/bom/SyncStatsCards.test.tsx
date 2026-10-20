import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncStatsCards } from './SyncStatsCards';
afterEach(cleanup);
describe('BOM sync summary', () => {
    it('routes each filter control correctly and keeps In Sync informational', () => {
        const change = vi.fn();
        render(<SyncStatsCards stats={{ total: 10, needsSync: 3, inSync: 7, errors: 2 }} errorCount={2} activeTab="pending" onTabChange={change} />);
        fireEvent.click(screen.getByRole('button', { name: /Total BOM Products/ })); expect(change).toHaveBeenLastCalledWith('all');
        fireEvent.click(screen.getByRole('button', { name: /Needs Sync/ })); expect(change).toHaveBeenLastCalledWith('pending');
        fireEvent.click(screen.getByRole('button', { name: /Errors/ })); expect(change).toHaveBeenLastCalledWith('errors');
        expect(screen.getByRole('button', { name: /Needs Sync/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('button', { name: /In Sync/ })).toBeNull();
        expect(screen.getByText('In Sync').parentElement).toHaveTextContent('7');
        for (const button of screen.getAllByRole('button')) expect(button).toHaveAttribute('type', 'button');
    });
});
