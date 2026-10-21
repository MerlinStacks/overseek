/**
 * BackupStorage - Storage operations for account backups
 * 
 * Handles saving, listing, retrieving, and deleting backup files.
 * Extracted from AccountBackupService.ts for improved modularity.
 * 
 * EDGE CASE FIX: Uses atomic writes (temp file + rename) and SHA256 checksums
 * to prevent corrupted backups from interrupted writes.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { AccountBackup, StoredBackupInfo, BackupSettings } from './types';
import { BACKUP_DIR, FREQUENCY_MS } from './constants';

/**
 * Result of a backup write operation
 */
interface BackupWriteResult {
    sizeBytes: number;
    checksum: string; // SHA256 hex digest
}

/**
 * Stream-serialize JSON to avoid V8 string length limits on large datasets.
 * Writes chunks directly to a gzip stream rather than building one giant string.
 * 
 * EDGE CASE FIX: Uses atomic write pattern (temp file + rename) and computes
 * SHA256 checksum to prevent corrupted backups from interrupted writes.
 * If the process crashes mid-write, no partial file will exist at the final path.
 */
export async function streamSerializeToGzip(
    backup: AccountBackup,
    filePath: string
): Promise<BackupWriteResult> {
    const tempPath = `${filePath}.tmp.${crypto.randomUUID()}`;
    const hash = crypto.createHash('sha256');
    let sizeBytes = 0;
    async function* serialize() {
        yield '{"exportedAt":' + JSON.stringify(backup.exportedAt) + ',"version":' + JSON.stringify(backup.version) + ',"account":' + JSON.stringify(backup.account) + ',"data":{';
        const keys = Object.keys(backup.data);
        for (let index = 0; index < keys.length; index++) {
            const key = keys[index];
            yield (index ? ',' : '') + JSON.stringify(key) + ':[';
            const records = backup.data[key];
            for (let start = 0; start < records.length; start += 500) {
                yield (start ? ',' : '') + records.slice(start, start + 500).map(record => JSON.stringify(record) ?? 'null').join(',');
            }
            yield ']';
        }
        yield '}}';
    }
    try {
        await pipeline(
            Readable.from(serialize(), { objectMode: false }),
            zlib.createGzip(),
            new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); sizeBytes += chunk.length; callback(null, chunk); } }),
            fs.createWriteStream(tempPath, { flags: 'wx' }),
        );
        await fs.promises.rename(tempPath, filePath);
        return { sizeBytes, checksum: hash.digest('hex') };
    } catch (error) {
        await fs.promises.unlink(tempPath).catch(() => {});
        throw error;
    }
}

/**
 * Save backup to storage and create DB record
 */
export async function saveBackupToStorage(
    accountId: string,
    backup: AccountBackup,
    type: 'SCHEDULED' | 'MANUAL' = 'MANUAL'
): Promise<StoredBackupInfo> {
    // Ensure backup directory exists
    const accountBackupDir = path.join(BACKUP_DIR, accountId);
    if (!fs.existsSync(accountBackupDir)) {
        fs.mkdirSync(accountBackupDir, { recursive: true });
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup_${timestamp}_${crypto.randomUUID()}.json.gz`;
    const filePath = path.join(accountBackupDir, filename);

    // Stream-serialize to gzip to avoid V8 string length limits
    // EDGE CASE FIX: Uses atomic write (temp file + rename) with SHA256 checksum
    const { sizeBytes, checksum } = await streamSerializeToGzip(backup, filePath);

    // Count total records
    const recordCount = Object.values(backup.data).reduce((total, records) => total + records.length, 0);

    // Create DB record
    const stored = await prisma.storedBackup.create({
        data: {
            accountId,
            filename,
            sizeBytes,
            recordCount,
            status: 'COMPLETED',
            type,
        },
    }).catch(async error => {
        await fs.promises.unlink(filePath).catch(() => {});
        throw error;
    });

    // Update settings if scheduled
    if (type === 'SCHEDULED') {
        const settings = await prisma.accountBackupSettings.findUnique({
            where: { accountId },
        });
        if (settings) {
            const nextBackupAt = settings.isEnabled ? new Date(Date.now() + FREQUENCY_MS[settings.frequency]) : null;
            await prisma.accountBackupSettings.updateMany({
                where: { accountId, updatedAt: settings.updatedAt },
                data: {
                    lastBackupAt: new Date(),
                    nextBackupAt,
                },
            });
        }
    }

    Logger.info('[AccountBackup] Backup saved to storage', {
        accountId,
        filename,
        sizeBytes,
        recordCount,
        type,
        checksum, // EDGE CASE FIX: Log checksum for integrity verification
    });

    return {
        id: stored.id,
        accountId: stored.accountId,
        filename: stored.filename,
        sizeBytes: stored.sizeBytes,
        recordCount: stored.recordCount,
        status: stored.status,
        type: stored.type,
        createdAt: stored.createdAt,
    };
}

/**
 * List stored backups for an account
 */
export async function getStoredBackups(accountId: string): Promise<StoredBackupInfo[]> {
    const backups = await prisma.storedBackup.findMany({
        where: { accountId },
        orderBy: { createdAt: 'desc' },
    });

    return backups.map(b => ({
        id: b.id,
        accountId: b.accountId,
        filename: b.filename,
        sizeBytes: b.sizeBytes,
        recordCount: b.recordCount,
        status: b.status,
        type: b.type,
        createdAt: b.createdAt,
    }));
}

/**
 * Get backup file path for download
 */
export async function getBackupFilePath(backupId: string): Promise<string | null> {
    const backup = await prisma.storedBackup.findUnique({
        where: { id: backupId },
    });

    if (!backup) return null;

    const filePath = path.join(BACKUP_DIR, backup.accountId, backup.filename);
    if (!fs.existsSync(filePath)) {
        Logger.warn('[AccountBackup] Backup file not found', { backupId, filePath });
        return null;
    }

    return filePath;
}

/**
 * Delete a stored backup
 */
export async function deleteStoredBackup(backupId: string): Promise<boolean> {
    const backup = await prisma.storedBackup.findUnique({
        where: { id: backupId },
    });

    if (!backup) return false;

    // Delete file
    const filePath = path.join(BACKUP_DIR, backup.accountId, backup.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }

    // Delete DB record
    await prisma.storedBackup.delete({ where: { id: backupId } });

    Logger.info('[AccountBackup] Backup deleted', { backupId, filename: backup.filename });
    return true;
}

/**
 * Apply retention policy - delete oldest backups if exceeding max
 */
export async function applyRetentionPolicy(
    accountId: string,
    getSettings: (id: string) => Promise<BackupSettings>
): Promise<number> {
    const settings = await getSettings(accountId);
    const maxBackups = settings.maxBackups;

    const backups = await prisma.storedBackup.findMany({
        where: { accountId },
        orderBy: { createdAt: 'desc' },
    });

    if (backups.length <= maxBackups) {
        return 0;
    }

    // Delete oldest backups
    const toDelete = backups.slice(maxBackups);
    let deleted = 0;

    for (const backup of toDelete) {
        const success = await deleteStoredBackup(backup.id);
        if (success) deleted++;
    }

    Logger.info('[AccountBackup] Retention policy applied', {
        accountId,
        maxBackups,
        deleted,
    });

    return deleted;
}
