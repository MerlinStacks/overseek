/**
 * Backup Types and Constants
 * 
 * Shared types and constants for the backup service modules.
 */

import * as path from 'path';


export interface BackupOptions {
    includeAuditLogs?: boolean;  // Default: false (can be large)
    includeAnalytics?: boolean;  // Default: false (session data)
}

export interface BackupPreview {
    accountId: string;
    accountName: string;
    recordCounts: Record<string, number>;
    estimatedSizeKB: number;
}

export interface AccountBackup {
    exportedAt: string;
    version: string;
    account: Record<string, unknown>;
    data: Record<string, unknown[]>;
}

export interface BackupSettings {
    isEnabled: boolean;
    frequency: 'DAILY' | 'EVERY_3_DAYS' | 'WEEKLY';
    maxBackups: number;
    lastBackupAt: Date | null;
    nextBackupAt: Date | null;
}

export interface StoredBackupInfo {
    id: string;
    filename: string;
    sizeBytes: number;
    recordCount: number;
    status: string;
    type: string;
    createdAt: Date;
}

export interface RestoreResult {
    success: boolean;
    restoredTables: string[];
    error?: string;
}

export interface ScheduledBackupResult {
    processed: number;
    failed: number;
}
