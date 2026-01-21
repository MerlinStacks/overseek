/**
 * Backup Constants
 * 
 * Shared constants for the backup service modules.
 */

import * as path from 'path';

export const BACKUP_VERSION = '1.0';
export const BACKUP_DIR = path.join(__dirname, '../../../data/backups');

// Frequency to milliseconds
export const FREQUENCY_MS: Record<string, number> = {
    DAILY: 24 * 60 * 60 * 1000,
    EVERY_3_DAYS: 3 * 24 * 60 * 60 * 1000,
    WEEKLY: 7 * 24 * 60 * 60 * 1000,
};

// Fields to exclude from account record (sensitive)
export const SENSITIVE_ACCOUNT_FIELDS = [
    'wooConsumerKey',
    'wooConsumerSecret',
    'webhookSecret',
    'openRouterApiKey',
];
