import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetOperationalAlertStateForTests, sendOperationalAlert } from './OperationalAlertService';

describe('OperationalAlertService', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
        resetOperationalAlertStateForTests();
        process.env.OPERATIONAL_ALERT_WEBHOOK_URL = 'https://alerts.example.test/webhook';
        process.env.OPERATIONAL_ALERT_COOLDOWN_MS = '600000';
        process.env.OPERATIONAL_ALERT_ENV = 'test';
        process.env.APP_NAME = 'OverSeek';
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        process.env = { ...originalEnv };
        resetOperationalAlertStateForTests();
    });

    it('does not send when alerts are disabled', async () => {
        process.env.OPERATIONAL_ALERTS_ENABLED = 'false';

        sendOperationalAlert({
            severity: 'error',
            category: 'test',
            title: 'Disabled alert',
        });

        await Promise.resolve();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('posts redacted alert payloads to the configured webhook', async () => {
        sendOperationalAlert({
            severity: 'critical',
            category: 'test',
            title: 'Database down',
            message: 'Connection failed',
            metadata: {
                accountId: 'acct_123',
                apiToken: 'secret-token',
                nested: { authorization: 'Bearer secret' },
            },
        });

        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [url, init] = (fetch as any).mock.calls[0];
        const body = JSON.parse(init.body);

        expect(url).toBe('https://alerts.example.test/webhook');
        expect(body.text).toContain('[OverSeek test] CRITICAL: Database down');
        expect(body.metadata.accountId).toBe('acct_123');
        expect(body.metadata.apiToken).toBe('[redacted]');
        expect(body.metadata.nested.authorization).toBe('[redacted]');
    });

    it('deduplicates alerts by fingerprint during the cooldown window', async () => {
        const alert = {
            severity: 'error' as const,
            category: 'test',
            title: 'Repeated failure',
            fingerprint: 'same-alert',
        };

        sendOperationalAlert(alert);
        sendOperationalAlert(alert);

        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    });
});
