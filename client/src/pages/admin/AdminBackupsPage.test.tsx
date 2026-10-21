import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ token: 'token', fetch: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: m.token, user: { id: 'admin', isSuperAdmin: true } }) }));
import { AdminBackupsPage } from './AdminBackupsPage';
const json = (value: unknown, ok = true) => ({ ok, json: async () => value });
const backup = (accountId: string) => ({ id: `backup-${accountId}`, accountId, filename: `${accountId}.gz`, sizeBytes: 1000, recordCount: 1, status: 'COMPLETED', type: 'MANUAL', createdAt: 'invalid' });
function reads(url: string) {
    if (url === '/api/admin/accounts') return Promise.resolve(json([{ id: 'a', name: 'Account A' }, { id: 'b', name: 'Account B' }]));
    const accountId = url.includes('/accounts/b/') ? 'b' : 'a';
    if (url.endsWith('/preview')) return Promise.resolve(json({ accountId, accountName: accountId === 'a' ? 'Account A' : 'Account B', recordCounts: { products: 0 }, estimatedSizeKB: 0 }));
    if (url.endsWith('/settings')) return Promise.resolve(json({ isEnabled: false, frequency: 'DAILY', maxBackups: 5, lastBackupAt: null, nextBackupAt: null }));
    return Promise.resolve(json([backup(accountId)]));
}
beforeEach(() => { vi.resetAllMocks(); m.token = 'token'; m.fetch.mockImplementation(reads); vi.stubGlobal('fetch', m.fetch); vi.stubGlobal('confirm', vi.fn(() => true)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function selectA() { fireEvent.change(await screen.findByRole('combobox', { name: 'Select Account' }), { target: { value: 'a' } }); await screen.findByText('New Backup Preview · Account A'); }
describe('admin backup target isolation', () => {
    it('closes restore confirmation and clears account data synchronously on a selection change', async () => {
        render(<AdminBackupsPage />); await selectA(); fireEvent.click(screen.getByRole('button', { name: 'Restore a.gz' })); expect(screen.getByRole('dialog')).toHaveTextContent('Account A');
        fireEvent.change(screen.getByRole('combobox', { name: 'Select Account', hidden: true }), { target: { value: 'b' } }); expect(screen.queryByRole('dialog')).toBeNull(); await screen.findByText('New Backup Preview · Account B'); expect(screen.queryByText('New Backup Preview · Account A')).toBeNull();
    });
    it('binds restore submission to the chosen account and serializes duplicate confirmations', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockImplementation((url, options) => options?.method === 'POST' ? new Promise(r => { resolve = r; }) : reads(url)); render(<AdminBackupsPage />); await selectA();
        fireEvent.click(screen.getByRole('button', { name: 'Restore a.gz' })); fireEvent.change(screen.getByLabelText('Account name confirmation'), { target: { value: 'Account A' } }); const button = screen.getByRole('button', { name: 'Confirm Restore' }); fireEvent.click(button); fireEvent.click(button);
        const mutations = m.fetch.mock.calls.filter(([, options]) => options?.method === 'POST'); expect(mutations).toHaveLength(1); expect(JSON.parse(mutations[0][1].body)).toEqual({ accountId: 'a', confirmAccountName: 'Account A' });
        await act(async () => { resolve(json({ success: true, restoredTables: ['policies'] })); }); await screen.findByText('Restored: policies.');
    });
    it('rejects failed reads instead of presenting an empty backup list', async () => {
        m.fetch.mockImplementation(url => url.endsWith('/backups') ? Promise.resolve(json({}, false)) : reads(url)); render(<AdminBackupsPage />);
        fireEvent.change(await screen.findByRole('combobox', { name: 'Select Account' }), { target: { value: 'a' } }); await screen.findByRole('alert'); expect(screen.queryByText('No stored backups.')).toBeNull(); expect(screen.queryByRole('button', { name: 'Save to Storage' })).toBeNull();
    });
    it('ignores old account reads that resolve after switching', async () => {
        let resolve!: (value: unknown) => void; m.fetch.mockImplementation(url => url.includes('/accounts/a/') && url.endsWith('/preview') ? new Promise(r => { resolve = r; }) : reads(url)); render(<AdminBackupsPage />);
        fireEvent.change(await screen.findByRole('combobox', { name: 'Select Account' }), { target: { value: 'a' } }); await waitFor(() => expect(m.fetch.mock.calls.some(([url]) => url.includes('/accounts/a/backup/preview'))).toBe(true));
        fireEvent.change(screen.getByRole('combobox', { name: 'Select Account' }), { target: { value: 'b' } }); await screen.findByText('New Backup Preview · Account B');
        await act(async () => { resolve(json({ accountId: 'a', accountName: 'Account A', recordCounts: {}, estimatedSizeKB: 0 })); }); expect(screen.queryByText('New Backup Preview · Account A')).toBeNull();
    });
    it('exposes failed deletes and requires refreshed data before allowing another destructive action', async () => {
        m.fetch.mockImplementation((url, options) => options?.method === 'DELETE' ? Promise.resolve(json({}, false)) : reads(url)); render(<AdminBackupsPage />); await selectA();
        fireEvent.click(screen.getByRole('button', { name: 'Delete a.gz' })); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Delete a.gz' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh account backup data' })); await screen.findByRole('button', { name: 'Delete a.gz' });
    });
});
