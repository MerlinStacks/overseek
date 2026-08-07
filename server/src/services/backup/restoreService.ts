/**
 * RestoreService - Restore account data from backups
 * 
 * Handles full account restoration from backup files.
 * WARNING: Restore operations are destructive and replace existing data.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import type { AccountBackup, RestoreResult } from './types';
import { BACKUP_DIR } from './constants';

const gunzip = promisify(zlib.gunzip);

const UNSUPPORTED_RESTORE_TABLES = ['products', 'customers'] as const;

export function getUnsupportedRestoreTables(backupData: AccountBackup): string[] {
    return UNSUPPORTED_RESTORE_TABLES.filter((table) => {
        const records = backupData.data[table];
        return Array.isArray(records) && records.length > 0;
    });
}

function resolveBackupFilePath(accountId: string, filename: string): string {
    if (path.basename(filename) !== filename) {
        throw new Error('Invalid backup filename');
    }

    const backupRoot = path.resolve(BACKUP_DIR);
    const accountBackupDir = path.resolve(backupRoot, accountId);
    if (!accountBackupDir.startsWith(`${backupRoot}${path.sep}`)) {
        throw new Error('Invalid backup account path');
    }

    const filePath = path.resolve(accountBackupDir, filename);
    if (!filePath.startsWith(`${accountBackupDir}${path.sep}`)) {
        throw new Error('Invalid backup file path');
    }

    return filePath;
}

/**
 * Restore account data from a backup
 * WARNING: This is a destructive operation that replaces existing data
 */
export async function restoreFromBackup(backupId: string): Promise<RestoreResult> {
    const backup = await prisma.storedBackup.findUnique({
        where: { id: backupId },
    });

    if (!backup) {
        return { success: false, restoredTables: [], error: 'Backup not found' };
    }

    // Mark as restoring
    await prisma.storedBackup.update({
        where: { id: backupId },
        data: { status: 'RESTORING' },
    });

    try {
        // Read and decompress backup file
        const filePath = resolveBackupFilePath(backup.accountId, backup.filename);
        if (!fs.existsSync(filePath)) {
            throw new Error('Backup file not found on disk');
        }

        const compressed = fs.readFileSync(filePath);
        const jsonData = await gunzip(compressed);
        const backupData: AccountBackup = JSON.parse(jsonData.toString('utf-8'));

        const unsupportedTables = getUnsupportedRestoreTables(backupData);
        if (unsupportedTables.length > 0) {
            throw new Error(
                `Restore is not supported for: ${unsupportedTables.join(', ')}. No account data was changed.`
            );
        }

        const restoredTables: string[] = [];
        const accountId = backup.accountId;

        // Restore in transaction
        await prisma.$transaction(async (tx) => {
            // Note: We restore only certain tables that are safe to replace
            // We do NOT restore: users, account settings, sync states

            // Restore canned responses
            if (backupData.data.cannedResponses?.length) {
                await tx.cannedResponse.deleteMany({ where: { accountId } });
                for (const cr of backupData.data.cannedResponses as any[]) {
                    await tx.cannedResponse.create({
                        data: {
                            accountId,
                            shortcut: cr.shortcut,
                            content: cr.content,
                        },
                    });
                }
                restoredTables.push('cannedResponses');
            }

            // Restore email templates
            if (backupData.data.emailTemplates?.length) {
                await tx.emailTemplate.deleteMany({ where: { accountId } });
                for (const et of backupData.data.emailTemplates as any[]) {
                    await tx.emailTemplate.create({
                        data: {
                            accountId,
                            name: et.name,
                            subject: et.subject,
                            content: et.content,
                            designJson: et.designJson,
                        },
                    });
                }
                restoredTables.push('emailTemplates');
            }

            // Restore policies
            if (backupData.data.policies?.length) {
                await tx.policy.deleteMany({ where: { accountId } });
                for (const p of backupData.data.policies as any[]) {
                    await tx.policy.create({
                        data: {
                            accountId,
                            title: p.title,
                            content: p.content,
                            type: p.type,
                            category: p.category,
                            isPublished: p.isPublished,
                        },
                    });
                }
                restoredTables.push('policies');
            }

            // Restore invoice templates
            if (backupData.data.invoiceTemplates?.length) {
                await tx.invoiceTemplate.deleteMany({ where: { accountId } });
                for (const it of backupData.data.invoiceTemplates as any[]) {
                    await tx.invoiceTemplate.create({
                        data: {
                            accountId,
                            name: it.name,
                            layout: it.layout,
                        },
                    });
                }
                restoredTables.push('invoiceTemplates');
            }
        });

        // Mark as completed
        await prisma.storedBackup.update({
            where: { id: backupId },
            data: { status: 'COMPLETED' },
        });

        Logger.info('[AccountBackup] Restore completed', {
            backupId,
            accountId,
            restoredTables,
        });

        return { success: true, restoredTables };
    } catch (error: any) {
        // Mark as failed
        await prisma.storedBackup.update({
            where: { id: backupId },
            data: { status: 'COMPLETED' }, // Reset status
        });

        Logger.error('[AccountBackup] Restore failed', { backupId, error });
        return { success: false, restoredTables: [], error: error.message };
    }
}
