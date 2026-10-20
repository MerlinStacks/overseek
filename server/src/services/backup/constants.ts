/**
 * Backup Constants
 * 
 * Shared constants for the backup service modules.
 */

import * as path from 'path';

export const BACKUP_VERSION = '1.0';
export const BACKUP_DIR = path.join(__dirname, '../../../data/backups');

// Frequency to milliseconds
export const FREQUENCY_MS = {
    DAILY: 24 * 60 * 60 * 1000,
    EVERY_3_DAYS: 3 * 24 * 60 * 60 * 1000,
    WEEKLY: 7 * 24 * 60 * 60 * 1000,
} as const;

export type BackupFrequency = keyof typeof FREQUENCY_MS;

/** The legacy backup API materializes one JSON object; fail safely above this budget. */
export const BACKUP_LIMITS = {
    batchSize: 500,
    maxSerializedBytes: 100 * 1024 * 1024,
    transactionTimeoutMs: 120_000,
} as const;

// Fields to exclude from account record (sensitive)
export const SENSITIVE_ACCOUNT_FIELDS = [
    'wooConsumerKey',
    'wooConsumerSecret',
    'webhookSecret',
    'openRouterApiKey',
] as const;

export const SENSITIVE_EMAIL_FIELDS = ['smtpPassword', 'imapPassword', 'relayApiKey'] as const;
