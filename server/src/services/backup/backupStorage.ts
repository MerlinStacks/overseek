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
    // Write to temp file first, then atomically rename
    const tempPath = `${filePath}.tmp.${Date.now()}`;

    return new Promise((resolve, reject) => {
        const gzStream = zlib.createGzip();
        const writeStream = fs.createWriteStream(tempPath);
        const hashStream = crypto.createHash('sha256');

        // Pipe gzip output to both file and hash calculator
        gzStream.on('data', (chunk: Buffer) => {
            writeStream.write(chunk);
            hashStream.update(chunk);
        });

        gzStream.on('end', () => {
            writeStream.end();
        });

        writeStream.on('finish', () => {
            try {
                const stats = fs.statSync(tempPath);
                const checksum = hashStream.digest('hex');

                // EDGE CASE FIX: Atomic rename from temp to final path
                // If this fails, no corrupted file will exist at the final path
                fs.renameSync(tempPath, filePath);

                resolve({
                    sizeBytes: stats.size,
                    checksum
                });
            } catch (renameError) {
                // Clean up temp file if rename fails
                try {
                    fs.unlinkSync(tempPath);
                } catch {
                    // Ignore cleanup errors
                }
                reject(renameError);
            }
        });

        writeStream.on('error', (err) => {
            // Clean up temp file on write error
            try {
                fs.unlinkSync(tempPath);
            } catch {
                // Ignore cleanup errors
            }
            reject(err);
        });

        gzStream.on('error', (err) => {
            // Clean up temp file on gzip error
            try {
                fs.unlinkSync(tempPath);
            } catch {
                // Ignore cleanup errors
            }
            reject(err);
        });

        // Write opening brace and metadata fields
        gzStream.write('{"exportedAt":' + JSON.stringify(backup.exportedAt) + ',');
        gzStream.write('"version":' + JSON.stringify(backup.version) + ',');
        gzStream.write('"account":' + JSON.stringify(backup.account) + ',');
        gzStream.write('"data":{');

        // Stream each data key separately to avoid giant string allocation
        const dataKeys = Object.keys(backup.data);
        dataKeys.forEach((key, keyIndex) => {
            gzStream.write(JSON.stringify(key) + ':[');

            const records = backup.data[key];
            // Write records in chunks to avoid memory spikes
            const CHUNK_SIZE = 500;
            for (let i = 0; i < records.length; i += CHUNK_SIZE) {
                const chunk = records.slice(i, i + CHUNK_SIZE);
                const chunkJson = chunk.map(r => JSON.stringify(r)).join(',');
                if (i > 0 && chunkJson) {
                    gzStream.write(',');
                }
                gzStream.write(chunkJson);
            }

            gzStream.write(']');
            if (keyIndex < dataKeys.length - 1) {
                gzStream.write(',');
            }
        });

        // Close data object and root object
        gzStream.write('}}');
        gzStream.end();
    });
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
    const filename = `backup_${timestamp}.json.gz`;
    const filePath = path.join(accountBackupDir, filename);

    // Stream-serialize to gzip to avoid V8 string length limits
    // EDGE CASE FIX: Uses atomic write (temp file + rename) with SHA256 checksum
    const { sizeBytes, checksum } = await streamSerializeToGzip(backup, filePath);

    // Count total records
    const recordCount = Object.values(backup.data).flat().length;

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
    });

    // Update settings if scheduled
    if (type === 'SCHEDULED') {
        const settings = await prisma.accountBackupSettings.findUnique({
            where: { accountId },
        });
        if (settings) {
            const nextBackupAt = new Date(Date.now() + FREQUENCY_MS[settings.frequency]);
            await prisma.accountBackupSettings.update({
                where: { accountId },
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
