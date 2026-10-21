import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { gunzipSync } from 'zlib';
import { createHash } from 'crypto';
const mocks = vi.hoisted(() => ({ directory: '', create: vi.fn(), findMany: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { storedBackup: { create: mocks.create, findMany: mocks.findMany } } }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn() } }));
vi.mock('./constants', () => ({ get BACKUP_DIR() { return mocks.directory; }, FREQUENCY_MS: {} }));
import { getStoredBackups, saveBackupToStorage, streamSerializeToGzip } from './backupStorage';
import type { AccountBackup } from './types';
const backup = (): AccountBackup => ({ exportedAt: '2026-10-20', version: '1', account: { id: 'account' }, data: { orders: [{ id: 1 }], products: [] } });
beforeEach(async () => {
    mocks.directory = await fs.mkdtemp(path.join(process.cwd(), '.backup-test-'));
    mocks.create.mockImplementation(async ({ data }) => ({ ...data, id: 'stored', createdAt: new Date() }));
});
afterEach(async () => { await fs.rm(mocks.directory, { recursive: true, force: true }); vi.restoreAllMocks(); vi.clearAllMocks(); });
describe('backup streaming and publication', () => {
    it('includes owning account identity in listed backup metadata', async () => {
        mocks.findMany.mockResolvedValue([{ id: 'stored', accountId: 'account', filename: 'backup.gz', sizeBytes: 1, recordCount: 0, status: 'COMPLETED', type: 'MANUAL', createdAt: new Date() }]);
        expect(await getStoredBackups('account')).toEqual([expect.objectContaining({ id: 'stored', accountId: 'account' })]);
        expect(mocks.findMany).toHaveBeenCalledWith({ where: { accountId: 'account' }, orderBy: { createdAt: 'desc' } });
    });
    it('produces complete gzip JSON and a checksum over the compressed bytes', async () => {
        const file = path.join(mocks.directory, 'backup.gz'); const data = backup();
        data.data.orders = Array.from({ length: 1600 }, (_, id) => ({ id, note: 'x'.repeat(200) }));
        const result = await streamSerializeToGzip(data, file); const bytes = await fs.readFile(file);
        expect(JSON.parse(gunzipSync(bytes).toString())).toEqual(data);
        expect(result).toEqual({ sizeBytes: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex') });
        expect(await fs.readdir(mocks.directory)).toEqual(['backup.gz']);
    });
    it('cleans partial streams when serialization fails and preserves a pre-existing final file', async () => {
        const file = path.join(mocks.directory, 'backup.gz'); await fs.writeFile(file, 'original');
        const data = backup(); const circular: Record<string, unknown> = {}; circular.self = circular; data.data.orders = [circular];
        await expect(streamSerializeToGzip(data, file)).rejects.toThrow();
        expect(await fs.readFile(file, 'utf8')).toBe('original'); expect(await fs.readdir(mocks.directory)).toEqual(['backup.gz']);
    });
    it('rejects destination errors rather than publishing a partial backup', async () => {
        await expect(streamSerializeToGzip(backup(), path.join(mocks.directory, 'missing', 'backup.gz'))).rejects.toThrow();
        expect(await fs.readdir(mocks.directory)).toEqual([]);
    });
    it('removes its temporary file if the final atomic rename fails', async () => {
        const target = path.join(mocks.directory, 'existing-directory'); await fs.mkdir(target);
        await expect(streamSerializeToGzip(backup(), target)).rejects.toThrow();
        expect(await fs.readdir(mocks.directory)).toEqual(['existing-directory']);
    });
    it('does not overwrite backups saved concurrently in the same second', async () => {
        const results = await Promise.all([saveBackupToStorage('account', backup()), saveBackupToStorage('account', backup())]);
        expect(results[0].filename).not.toBe(results[1].filename);
        const files = await fs.readdir(path.join(mocks.directory, 'account')); expect(files).toHaveLength(2);
    });
    it('removes its file if database registration fails', async () => {
        mocks.create.mockRejectedValueOnce(new Error('Database unavailable'));
        await expect(saveBackupToStorage('account', backup())).rejects.toThrow('Database unavailable');
        expect(await fs.readdir(path.join(mocks.directory, 'account'))).toEqual([]);
    });
    it('preserves JSON array semantics for undefined records', async () => {
        const data = backup(); data.data.orders = [undefined]; const file = path.join(mocks.directory, 'backup.gz');
        await streamSerializeToGzip(data, file); expect(JSON.parse(gunzipSync(await fs.readFile(file)).toString()).data.orders).toEqual([null]);
    });
});
