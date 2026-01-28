/**
 * AccountBackupService
 * 
 * Facade for backup operations, delegating to modular components.
 * Provides settings management and scheduled backup orchestration.
 * 
 * Modular sub-services (in backup/):
 * - backupStorage.ts: File storage operations
 * - backupGenerator.ts: Data collection and serialization
 * - restoreService.ts: Data restoration logic
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import {
    BackupSettings,
    AccountBackup,
    BackupOptions,
    BackupPreview,
    StoredBackupInfo,
    RestoreResult,
    ScheduledBackupResult,
    FREQUENCY_MS,
    saveBackupToStorage,
    getStoredBackups,
    getBackupFilePath,
    deleteStoredBackup,
    applyRetentionPolicy,
} from './backup';
import { generateBackup, getBackupPreview } from './backup/backupGenerator';
import { restoreFromBackup } from './backup/restoreService';

// Re-export types for backward compatibility
export type {
    BackupSettings,
    AccountBackup,
    BackupOptions,
    BackupPreview,
    StoredBackupInfo,
};

export class AccountBackupService {
    // =========================================
    // SETTINGS MANAGEMENT
    // =========================================

    /**
     * Get backup settings for an account
     */
    static async getSettings(accountId: string): Promise<BackupSettings> {
        const settings = await prisma.accountBackupSettings.findUnique({
            where: { accountId },
        });

        if (!settings) {
            return {
                isEnabled: false,
                frequency: 'WEEKLY',
                maxBackups: 5,
                lastBackupAt: null,
                nextBackupAt: null,
            };
        }

        return {
            isEnabled: settings.isEnabled,
            frequency: settings.frequency as 'DAILY' | 'EVERY_3_DAYS' | 'WEEKLY',
            maxBackups: settings.maxBackups,
            lastBackupAt: settings.lastBackupAt,
            nextBackupAt: settings.nextBackupAt,
        };
    }

    /**
     * Update backup settings for an account
     */
    static async updateSettings(
        accountId: string,
        updates: Partial<Pick<BackupSettings, 'isEnabled' | 'frequency' | 'maxBackups'>>
    ): Promise<BackupSettings> {
        // Calculate next backup time if enabling
        let nextBackupAt: Date | undefined;
        if (updates.isEnabled) {
            const frequency = updates.frequency || 'WEEKLY';
            nextBackupAt = new Date(Date.now() + FREQUENCY_MS[frequency]);
        } else if (updates.isEnabled === false) {
            nextBackupAt = undefined; // Will be set to null
        }

        const settings = await prisma.accountBackupSettings.upsert({
            where: { accountId },
            update: {
                ...updates,
                ...(nextBackupAt !== undefined && { nextBackupAt }),
                ...(updates.isEnabled === false && { nextBackupAt: null }),
            },
            create: {
                accountId,
                isEnabled: updates.isEnabled ?? false,
                frequency: updates.frequency ?? 'WEEKLY',
                maxBackups: updates.maxBackups ?? 5,
                nextBackupAt: updates.isEnabled ? nextBackupAt : null,
            },
        });

        return {
            isEnabled: settings.isEnabled,
            frequency: settings.frequency as 'DAILY' | 'EVERY_3_DAYS' | 'WEEKLY',
            maxBackups: settings.maxBackups,
            lastBackupAt: settings.lastBackupAt,
            nextBackupAt: settings.nextBackupAt,
        };
    }

    // =========================================
    // DELEGATED STORAGE OPERATIONS
    // =========================================

    /** @see backupStorage.saveBackupToStorage */
    static saveBackupToStorage = saveBackupToStorage;

    /** @see backupStorage.getStoredBackups */
    static getStoredBackups = getStoredBackups;

    /** @see backupStorage.getBackupFilePath */
    static getBackupFilePath = getBackupFilePath;

    /** @see backupStorage.deleteStoredBackup */
    static deleteStoredBackup = deleteStoredBackup;

    /**
     * Apply retention policy - delete oldest backups if exceeding max
     */
    static async applyRetentionPolicy(accountId: string): Promise<number> {
        return applyRetentionPolicy(accountId, this.getSettings);
    }

    // =========================================
    // DELEGATED GENERATION OPERATIONS
    // =========================================

    /** @see backupGenerator.generateBackup */
    static generateBackup = generateBackup;

    /** @see backupGenerator.getBackupPreview */
    static getBackupPreview = getBackupPreview;

    // =========================================
    // DELEGATED RESTORE OPERATIONS
    // =========================================

    /** @see restoreService.restoreFromBackup */
    static restoreFromBackup = restoreFromBackup;

    // =========================================
    // SCHEDULED BACKUP RUNNER
    // =========================================

    /**
     * Check and run due scheduled backups (called by SchedulerService)
     */
    static async runScheduledBackups(): Promise<ScheduledBackupResult> {
        const now = new Date();

        // Find accounts with due backups
        const dueAccounts = await prisma.accountBackupSettings.findMany({
            where: {
                isEnabled: true,
                nextBackupAt: { lte: now },
            },
            include: { account: { select: { id: true, name: true } } },
        });

        let processed = 0;
        let failed = 0;

        for (const settings of dueAccounts) {
            try {
                Logger.info('[AccountBackup] Running scheduled backup', {
                    accountId: settings.accountId,
                    accountName: settings.account.name,
                });

                // Generate backup
                const backup = await this.generateBackup(settings.accountId);
                if (!backup) {
                    failed++;
                    continue;
                }

                // Save to storage
                await this.saveBackupToStorage(settings.accountId, backup, 'SCHEDULED');

                // Apply retention policy
                await this.applyRetentionPolicy(settings.accountId);

                processed++;
            } catch (error) {
                Logger.error('[AccountBackup] Scheduled backup failed', {
                    accountId: settings.accountId,
                    error,
                });
                failed++;
            }
        }

        if (processed > 0 || failed > 0) {
            Logger.info('[AccountBackup] Scheduled backup run complete', { processed, failed });
        }

        return { processed, failed };
    }
}
