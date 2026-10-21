import Fastify, { type FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getBackupPreview: vi.fn(), generateBackup: vi.fn(), saveBackupToStorage: vi.fn(),
    applyRetentionPolicy: vi.fn(), getSettings: vi.fn(), updateSettings: vi.fn(),
    getStoredBackups: vi.fn(), getBackupFilePath: vi.fn(), deleteStoredBackup: vi.fn(),
    restoreFromBackup: vi.fn(), createReadStream: vi.fn(),
    findBackup: vi.fn(),
}));
vi.mock('../../services/AccountBackupService', () => ({ AccountBackupService: mocks }));
vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock('fs', () => ({ createReadStream: mocks.createReadStream }));
vi.mock('../../utils/prisma', () => ({ prisma: { storedBackup: { findUnique: mocks.findBackup } } }));

import { backupRoutes } from './backup';

const accountUrl = '/accounts/tenant-1/backup';
const backup = { account: { name: 'My Store!' }, products: [] };

describe('admin backup routes', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
        vi.resetAllMocks();
        mocks.generateBackup.mockResolvedValue(backup);
        mocks.saveBackupToStorage.mockResolvedValue({ id: 'backup-1' });
        mocks.updateSettings.mockResolvedValue({ isEnabled: true });
        mocks.findBackup.mockResolvedValue({ accountId: 'tenant-1', status: 'COMPLETED', account: { name: 'My Store!' } });
        app = Fastify();
        await app.register(backupRoutes);
    });
    afterEach(async () => { await app.close(); });

    it.each(['', '/save'])('allows an omitted options body and defaults flags to false: %s', async suffix => {
        const response = await app.inject({ method: 'POST', url: accountUrl + suffix });
        expect(response.statusCode).toBe(200);
        expect(mocks.generateBackup).toHaveBeenCalledExactlyOnceWith('tenant-1', { includeAuditLogs: false, includeAnalytics: false });
    });

    it.each(['', '/save'])('preserves explicit boolean flags: %s', async suffix => {
        const response = await app.inject({ method: 'POST', url: accountUrl + suffix, payload: { includeAuditLogs: false, includeAnalytics: true } });
        expect(response.statusCode).toBe(200);
        expect(mocks.generateBackup).toHaveBeenCalledWith('tenant-1', { includeAuditLogs: false, includeAnalytics: true });
    });

    describe.each(['', '/save'])('backup options for %s', suffix => {
        it.each([
            { includeAuditLogs: 'false' }, { includeAnalytics: 'true' }, { includeAuditLogs: 0 },
            { includeAnalytics: null }, [], 'invalid',
        ])('rejects malformed options before any backup is generated: %j', async payload => {
            const response = await app.inject({
                method: 'POST', url: accountUrl + suffix,
                headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload),
            });
            expect(response.statusCode).toBe(400);
            expect(response.json().error).toBe('Validation failed');
            expect(mocks.generateBackup).not.toHaveBeenCalled();
            expect(mocks.saveBackupToStorage).not.toHaveBeenCalled();
            expect(mocks.applyRetentionPolicy).not.toHaveBeenCalled();
        });
    });

    it('returns a JSON attachment with a sanitized account filename', async () => {
        const response = await app.inject({ method: 'POST', url: accountUrl, payload: {} });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('application/json');
        expect(response.headers['content-disposition']).toMatch(/^attachment; filename="my_store__backup_\d{4}-\d{2}-\d{2}\.json"$/);
        expect(response.json()).toEqual(backup);
    });

    it('saves a manual backup before applying retention', async () => {
        const response = await app.inject({ method: 'POST', url: accountUrl + '/save', payload: {} });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ id: 'backup-1' });
        expect(mocks.saveBackupToStorage).toHaveBeenCalledWith('tenant-1', backup, 'MANUAL');
        expect(mocks.applyRetentionPolicy).toHaveBeenCalledWith('tenant-1');
        expect(mocks.saveBackupToStorage.mock.invocationCallOrder[0]).toBeLessThan(mocks.applyRetentionPolicy.mock.invocationCallOrder[0]);
    });

    it.each(['', '/save'])('returns 404 when the account does not exist: %s', async suffix => {
        mocks.generateBackup.mockResolvedValue(null);
        const response = await app.inject({ method: 'POST', url: accountUrl + suffix });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ error: 'Account not found' });
        expect(mocks.saveBackupToStorage).not.toHaveBeenCalled();
        expect(mocks.applyRetentionPolicy).not.toHaveBeenCalled();
    });

    it.each(['DAILY', 'EVERY_3_DAYS', 'WEEKLY'])('accepts supported settings for %s', async frequency => {
        const payload = { isEnabled: false, frequency, maxBackups: 5 };
        const response = await app.inject({ method: 'PUT', url: accountUrl + '/settings', payload });
        expect(response.statusCode).toBe(200);
        expect(mocks.updateSettings).toHaveBeenCalledExactlyOnceWith('tenant-1', payload);
    });

    it.each([{ maxBackups: 1 }, { maxBackups: 10 }, { isEnabled: false }, { frequency: 'DAILY' }, {}])('preserves partial settings updates: %j', async payload => {
        const response = await app.inject({ method: 'PUT', url: accountUrl + '/settings', payload });
        expect(response.statusCode).toBe(200);
        expect(mocks.updateSettings).toHaveBeenCalledWith('tenant-1', {
            isEnabled: undefined, frequency: undefined, maxBackups: undefined, ...payload,
        });
    });

    it.each([
        { isEnabled: 'false' }, { frequency: 'MONTHLY' }, { maxBackups: 0 }, { maxBackups: -1 },
        { maxBackups: 1.5 }, { maxBackups: '5' }, { maxBackups: null }, { maxBackups: 2_147_483_648 }, [],
    ])('rejects malformed settings before calling the service: %j', async payload => {
        const response = await app.inject({ method: 'PUT', url: accountUrl + '/settings', payload });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toBe('Validation failed');
        expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    it('returns 400 rather than 500 for a missing settings body', async () => {
        const response = await app.inject({ method: 'PUT', url: accountUrl + '/settings' });
        expect(response.statusCode).toBe(400);
        expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    it('streams stored downloads without changing their contents', async () => {
        mocks.getBackupFilePath.mockResolvedValue('/storage/backup-1.json.gz');
        mocks.createReadStream.mockReturnValue(Readable.from([Buffer.from('compressed-backup')]));
        const response = await app.inject({ method: 'GET', url: '/backups/backup-1/download' });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('application/gzip');
        expect(response.headers['content-disposition']).toBe('attachment; filename="backup-1.json.gz"');
        expect(response.body).toBe('compressed-backup');
        expect(mocks.getBackupFilePath).toHaveBeenCalledWith('backup-1');
    });

    it.each([
        { method: 'GET' as const, url: accountUrl + '/preview', service: 'getBackupPreview' as const, message: 'Account not found' },
        { method: 'GET' as const, url: '/backups/missing/download', service: 'getBackupFilePath' as const, message: 'Backup not found' },
        { method: 'DELETE' as const, url: '/backups/missing', service: 'deleteStoredBackup' as const, message: 'Backup not found' },
    ])('preserves missing-resource responses for $service', async ({ method, url, service, message }) => {
        mocks[service].mockResolvedValue(null);
        const response = await app.inject({ method, url });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ error: message });
    });

    it('preserves restoration results and the requested backup ID', async () => {
        mocks.restoreFromBackup.mockResolvedValue({ success: true, restored: 5 });
        const response = await app.inject({ method: 'POST', url: '/backups/backup-1/restore', payload: { accountId: 'tenant-1', confirmAccountName: 'My Store!' } });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true, restored: 5 });
        expect(mocks.restoreFromBackup).toHaveBeenCalledExactlyOnceWith('backup-1');
    });

    it.each([{}, { accountId: 'tenant-1', confirmAccountName: 'Wrong' }, { accountId: 'tenant-2', confirmAccountName: 'My Store!' }])('requires matching backup account/name before restoration: %j', async payload => {
        const response = await app.inject({ method: 'POST', url: '/backups/backup-1/restore', payload });
        expect(response.statusCode).toBe(400); expect(mocks.restoreFromBackup).not.toHaveBeenCalled();
    });

    it('rejects a restore already in progress', async () => {
        mocks.findBackup.mockResolvedValue({ accountId: 'tenant-1', status: 'RESTORING', account: { name: 'My Store!' } });
        const response = await app.inject({ method: 'POST', url: '/backups/backup-1/restore', payload: { accountId: 'tenant-1', confirmAccountName: 'My Store!' } });
        expect(response.statusCode).toBe(409); expect(mocks.restoreFromBackup).not.toHaveBeenCalled();
    });

    it.each([
        { method: 'POST' as const, url: accountUrl, service: 'generateBackup' as const, error: 'Failed to generate backup' },
        { method: 'POST' as const, url: accountUrl + '/save', service: 'saveBackupToStorage' as const, error: 'Failed to save backup' },
        { method: 'POST' as const, url: '/backups/backup-1/restore', service: 'restoreFromBackup' as const, error: 'Failed to restore backup' },
        { method: 'PUT' as const, url: accountUrl + '/settings', service: 'updateSettings' as const, error: 'Failed to update backup settings' },
        { method: 'GET' as const, url: '/backups/backup-1/download', service: 'getBackupFilePath' as const, error: 'Failed to download backup' },
    ])('does not leak internal errors from $service', async ({ method, url, service, error }) => {
        mocks[service].mockRejectedValue(new Error('private database credentials'));
        const response = await app.inject({ method, url, ...(url.endsWith('/restore') ? { payload: { accountId: 'tenant-1', confirmAccountName: 'My Store!' } } : method === 'PUT' ? { payload: {} } : {}) });
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ error });
    });
});
