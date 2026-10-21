import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn(), transaction: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { storedBackup: { findUnique: m.findUnique, updateMany: m.updateMany }, $transaction: m.transaction } }));
import { restoreFromBackup } from './restoreService';
beforeEach(() => vi.resetAllMocks());
describe('backup restore claiming', () => {
    it('does not read files or touch account data when another restore holds the claim', async () => {
        m.findUnique.mockResolvedValue({ id: 'backup', accountId: 'a' }); m.updateMany.mockResolvedValue({ count: 0 });
        expect(await restoreFromBackup('backup')).toMatchObject({ success: false, error: 'Backup is not available for restore' });
        expect(m.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { id: 'backup', status: 'COMPLETED' }, data: { status: 'RESTORING' } }); expect(m.transaction).not.toHaveBeenCalled();
    });
});
