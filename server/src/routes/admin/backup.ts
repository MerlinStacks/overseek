/**
 * Admin Backup Routes
 * 
 * Account backup management endpoints.
 * Extracted from admin.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { Logger } from '../../utils/logger';

export const backupRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /admin/accounts/:accountId/backup/preview
     * Get backup preview with record counts and estimated size
     */
    fastify.get<{ Params: { accountId: string } }>('/accounts/:accountId/backup/preview', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { AccountBackupService } = await import('../../services/AccountBackupService');

            const preview = await AccountBackupService.getBackupPreview(accountId);
            if (!preview) {
                return reply.code(404).send({ error: 'Account not found' });
            }

            return preview;
        } catch (e: any) {
            Logger.error('[Admin] Backup preview failed', { error: e });
            return reply.code(500).send({ error: 'Failed to generate backup preview' });
        }
    });

    /**
     * POST /admin/accounts/:accountId/backup
     * Generate and download full account backup as JSON
     */
    fastify.post<{
        Params: { accountId: string };
        Body: { includeAuditLogs?: boolean; includeAnalytics?: boolean };
    }>('/accounts/:accountId/backup', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { includeAuditLogs, includeAnalytics } = request.body || {};
            const { AccountBackupService } = await import('../../services/AccountBackupService');

            const backup = await AccountBackupService.generateBackup(accountId, {
                includeAuditLogs: Boolean(includeAuditLogs),
                includeAnalytics: Boolean(includeAnalytics),
            });

            if (!backup) {
                return reply.code(404).send({ error: 'Account not found' });
            }

            // Generate filename with account name and date
            const accountName = (backup.account as { name?: string }).name || 'account';
            const safeName = accountName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            const dateStr = new Date().toISOString().split('T')[0];
            const filename = `${safeName}_backup_${dateStr}.json`;

            // Send as downloadable JSON file
            reply.header('Content-Type', 'application/json');
            reply.header('Content-Disposition', `attachment; filename="${filename}"`);

            return backup;
        } catch (e: any) {
            Logger.error('[Admin] Backup generation failed', { error: e });
            return reply.code(500).send({ error: 'Failed to generate backup', details: e.message });
        }
    });

    /**
     * POST /admin/accounts/:accountId/backup/save
     * Generate and save backup to storage (instead of downloading)
     */
    fastify.post<{
        Params: { accountId: string };
        Body: { includeAuditLogs?: boolean; includeAnalytics?: boolean };
    }>('/accounts/:accountId/backup/save', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { includeAuditLogs, includeAnalytics } = request.body || {};
            const { AccountBackupService } = await import('../../services/AccountBackupService');

            const backup = await AccountBackupService.generateBackup(accountId, {
                includeAuditLogs: Boolean(includeAuditLogs),
                includeAnalytics: Boolean(includeAnalytics),
            });

            if (!backup) {
                return reply.code(404).send({ error: 'Account not found' });
            }

            // Save to storage
            const stored = await AccountBackupService.saveBackupToStorage(accountId, backup, 'MANUAL');

            // Apply retention policy
            await AccountBackupService.applyRetentionPolicy(accountId);

            return stored;
        } catch (e: any) {
            Logger.error('[Admin] Backup save failed', { error: e });
            return reply.code(500).send({ error: 'Failed to save backup', details: e.message });
        }
    });

    /**
     * GET /admin/accounts/:accountId/backup/settings
     * Get backup settings for an account
     */
    fastify.get<{ Params: { accountId: string } }>('/accounts/:accountId/backup/settings', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { AccountBackupService } = await import('../../services/AccountBackupService');
            const settings = await AccountBackupService.getSettings(accountId);
            return settings;
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to get backup settings' });
        }
    });

    /**
     * PUT /admin/accounts/:accountId/backup/settings
     * Update backup settings for an account
     */
    fastify.put<{
        Params: { accountId: string };
        Body: { isEnabled?: boolean; frequency?: string; maxBackups?: number };
    }>('/accounts/:accountId/backup/settings', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { isEnabled, frequency, maxBackups } = request.body;
            const { AccountBackupService } = await import('../../services/AccountBackupService');

            const settings = await AccountBackupService.updateSettings(accountId, {
                isEnabled,
                frequency: frequency as any,
                maxBackups,
            });

            Logger.info('[Admin] Backup settings updated', { accountId, settings });
            return settings;
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to update backup settings' });
        }
    });

    /**
     * GET /admin/accounts/:accountId/backups
     * List stored backups for an account
     */
    fastify.get<{ Params: { accountId: string } }>('/accounts/:accountId/backups', async (request, reply) => {
        try {
            const { accountId } = request.params;
            const { AccountBackupService } = await import('../../services/AccountBackupService');
            const backups = await AccountBackupService.getStoredBackups(accountId);
            return backups;
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to get stored backups' });
        }
    });

    /**
     * GET /admin/backups/:backupId/download
     * Download a stored backup file
     */
    fastify.get<{ Params: { backupId: string } }>('/backups/:backupId/download', async (request, reply) => {
        try {
            const { backupId } = request.params;
            const { AccountBackupService } = await import('../../services/AccountBackupService');
            const fs = await import('fs');

            const filePath = await AccountBackupService.getBackupFilePath(backupId);
            if (!filePath) {
                return reply.code(404).send({ error: 'Backup not found' });
            }

            const stream = fs.createReadStream(filePath);
            reply.header('Content-Type', 'application/gzip');
            reply.header('Content-Disposition', `attachment; filename="${filePath.split('/').pop() || 'backup.json.gz'}"`);
            return reply.send(stream);
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to download backup' });
        }
    });

    /**
     * DELETE /admin/backups/:backupId
     * Delete a stored backup
     */
    fastify.delete<{ Params: { backupId: string } }>('/backups/:backupId', async (request, reply) => {
        try {
            const { backupId } = request.params;
            const { AccountBackupService } = await import('../../services/AccountBackupService');

            const success = await AccountBackupService.deleteStoredBackup(backupId);
            if (!success) {
                return reply.code(404).send({ error: 'Backup not found' });
            }

            return { success: true };
        } catch (e: any) {
            return reply.code(500).send({ error: 'Failed to delete backup' });
        }
    });

    /**
     * POST /admin/backups/:backupId/restore
     * Restore from a stored backup
     */
    fastify.post<{ Params: { backupId: string } }>('/backups/:backupId/restore', async (request, reply) => {
        try {
            const { backupId } = request.params;
            const { AccountBackupService } = await import('../../services/AccountBackupService');

            const result = await AccountBackupService.restoreFromBackup(backupId);
            return result;
        } catch (e: any) {
            Logger.error('[Admin] Backup restore failed', { error: e });
            return reply.code(500).send({ error: 'Failed to restore backup', details: e.message });
        }
    });
};
