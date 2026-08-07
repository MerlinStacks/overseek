import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/auth', () => ({ requireAuthFastify: vi.fn() }));
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: vi.fn() } }));
vi.mock('../services/TwilioService', () => ({ TwilioService: {} }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/logger', () => ({ Logger: { warn: vi.fn(), error: vi.fn() } }));

import { sanitizeSmsSettingsResponse } from './sms';

describe('sanitizeSmsSettingsResponse', () => {
    it('never returns the Twilio auth token', () => {
        const response = sanitizeSmsSettingsResponse({
            id: 'settings-1',
            accountId: 'account-1',
            accountSid: 'AC00000000000000000000000000000000',
            authToken: 'super-secret-token',
            fromNumber: '+61400000000',
        });

        expect(response).not.toHaveProperty('authToken');
        expect(response.authTokenConfigured).toBe(true);
    });
});
