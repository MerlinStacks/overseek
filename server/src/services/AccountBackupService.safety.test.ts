import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), claim: vi.fn(), generate: vi.fn(), save: vi.fn(), retention: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { accountBackupSettings: { findUnique: m.findUnique, upsert: m.upsert, findMany: m.findMany, updateMany: m.claim }, $transaction: async task => task({ $queryRaw: vi.fn(), accountBackupSettings: { findUnique: m.findUnique, upsert: m.upsert } }) } }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('./backup', () => ({ FREQUENCY_MS: { DAILY: 86400000, EVERY_3_DAYS: 259200000, WEEKLY: 604800000 }, saveBackupToStorage: m.save, applyRetentionPolicy: m.retention, getStoredBackups: vi.fn(), getBackupFilePath: vi.fn(), deleteStoredBackup: vi.fn() }));
vi.mock('./backup/backupGenerator', () => ({ generateBackup: m.generate, getBackupPreview: vi.fn() }));
vi.mock('./backup/restoreService', () => ({ restoreFromBackup: vi.fn() }));
import { AccountBackupService as service } from './AccountBackupService';
beforeEach(() => { vi.resetAllMocks(); m.findUnique.mockResolvedValue({ isEnabled: false, frequency: 'DAILY', maxBackups: 5, lastBackupAt: null, nextBackupAt: null }); m.upsert.mockImplementation(async ({ update }) => update); m.generate.mockResolvedValue({}); m.claim.mockResolvedValue({ count: 1 }); });
describe('backup schedule derivation and atomic due claims', () => {
    it('uses the stored frequency when enabled without a frequency edit', async () => {
        const before = Date.now(); const settings = await service.updateSettings('tenant', { isEnabled: true }); expect(settings.nextBackupAt.getTime() - before).toBeGreaterThanOrEqual(86400000); expect(settings.nextBackupAt.getTime() - before).toBeLessThan(86401000);
    });
    it('recomputes the next occurrence after a frequency-only update', async () => {
        m.findUnique.mockResolvedValue({ isEnabled: true, frequency: 'WEEKLY', maxBackups: 5, nextBackupAt: new Date(0) });
        expect((await service.updateSettings('tenant', { frequency: 'DAILY' })).nextBackupAt.getTime()).toBeGreaterThan(Date.now());
    });
    it('skips generation after losing a claim to another runner', async () => {
        m.findMany.mockResolvedValue([{ accountId: 'tenant', nextBackupAt: new Date(0), frequency: 'DAILY', updatedAt: new Date(0), account: { name: 'Store' } }]); m.claim.mockResolvedValue({ count: 0 });
        expect(await service.runScheduledBackups()).toEqual({ processed: 0, failed: 0 }); expect(m.generate).not.toHaveBeenCalled();
    });
    it('claims before generation and retains the advanced due occurrence on failures', async () => {
        m.findMany.mockResolvedValue([{ accountId: 'tenant', nextBackupAt: new Date(0), frequency: 'DAILY', updatedAt: new Date(0), account: { name: 'Store' } }]); m.save.mockRejectedValue(new Error('Storage failed'));
        expect(await service.runScheduledBackups()).toEqual({ processed: 0, failed: 1 }); expect(m.claim.mock.invocationCallOrder[0]).toBeLessThan(m.generate.mock.invocationCallOrder[0]); expect(m.claim).toHaveBeenCalledOnce();
    });
});
