import { describe, expect, it } from 'vitest';
import { BACKUP_LIMITS, FREQUENCY_MS, SENSITIVE_ACCOUNT_FIELDS, SENSITIVE_EMAIL_FIELDS } from './constants';
describe('backup constants', () => {
    it('preserves supported schedule intervals', () => {
        expect(FREQUENCY_MS).toEqual({ DAILY: 86400000, EVERY_3_DAYS: 259200000, WEEKLY: 604800000 });
    });
    it('lists the actual credential field names', () => {
        expect(SENSITIVE_EMAIL_FIELDS).toEqual(['smtpPassword', 'imapPassword', 'relayApiKey']);
        expect(SENSITIVE_ACCOUNT_FIELDS).toEqual(['wooConsumerKey', 'wooConsumerSecret', 'webhookSecret', 'openRouterApiKey']);
    });
    it('defines bounded reads and a documented 100 MiB serialized-object budget', () => {
        expect(BACKUP_LIMITS).toEqual({ batchSize: 500, maxSerializedBytes: 100 * 1024 * 1024, transactionTimeoutMs: 120000 });
    });
});
