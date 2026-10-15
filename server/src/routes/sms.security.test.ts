import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { ChatService } from '../services/ChatService';

vi.mock('../middleware/auth', () => ({ requireAuthFastify: vi.fn(async () => {}) }));
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: vi.fn() } }));
vi.mock('../services/TwilioService', () => ({ TwilioService: { getSettings: vi.fn() } }));
vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/logger', () => ({ Logger: { warn: vi.fn(), error: vi.fn() } }));

import { createSmsRoutes, sanitizeSmsSettingsResponse } from './sms';
import { TwilioService } from '../services/TwilioService';
import { PermissionService } from '../services/PermissionService';

describe('SMS inbox capabilities', () => {
    beforeEach(() => vi.clearAllMocks());

    const settings = {
        enabled: true,
        accountSid: 'AC00000000000000000000000000000000',
        authToken: 'super-secret-token',
        fromNumber: '+61400000000',
    };

    it.each([
        [settings, true],
        [null, false],
        [{ ...settings, enabled: false }, false],
        [{ ...settings, authToken: '' }, false],
        [{ ...settings, accountSid: '' }, false],
        [{ ...settings, fromNumber: '' }, false],
    ])('returns only availability for the current account (%j)', async (configured, expected) => {
        vi.mocked(TwilioService.getSettings).mockResolvedValue(configured as never);
        const app = Fastify();
        app.addHook('preHandler', async (request) => { request.accountId = 'account-1'; });
        await app.register(createSmsRoutes({} as ChatService));
        try {
            const response = await app.inject({ method: 'GET', url: '/capabilities' });
            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ canSendSms: expected });
            expect(TwilioService.getSettings).toHaveBeenCalledWith('account-1');
            expect(PermissionService.hasPermission).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('rejects requests without account context', async () => {
        const app = Fastify();
        await app.register(createSmsRoutes({} as ChatService));
        try {
            const response = await app.inject({ method: 'GET', url: '/capabilities' });
            expect(response.statusCode).toBe(400);
            expect(TwilioService.getSettings).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });
});

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
