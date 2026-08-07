import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resend: vi.fn(), activate: vi.fn(), rotatePassword: vi.fn(), setNotificationsMuted: vi.fn() }));
vi.mock('../../middleware/auth', () => ({ requireAuthFastify: async (request: any) => { request.accountId = 'account-1'; request.user = { id: 'user-1' }; } }));
vi.mock('../../services/PermissionService', () => ({ PermissionService: { hasPermission: vi.fn().mockResolvedValue(true) } }));
vi.mock('../../utils/accountFeatures', () => ({ isAccountFeatureEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock('../../services/wholesale/authorization', () => ({ hasWholesaleAccountMembership: vi.fn().mockResolvedValue(true), isWholesaleDefaultsApprover: vi.fn() }));
vi.mock('../../services/wholesale/shares', () => ({ WholesaleShareService: { resend: mocks.resend, activate: mocks.activate, rotatePassword: mocks.rotatePassword, setNotificationsMuted: mocks.setNotificationsMuted } }));
vi.mock('../../services/wholesale/generations', () => ({ WholesaleGenerationService: {} }));
vi.mock('../../utils/prisma', () => ({ prisma: {} }));
vi.mock('../../services/AuditService', () => ({ AuditActions: {}, AuditService: { log: vi.fn() } }));

import wholesaleCatalogRoutes from './index';

describe('wholesale resend route alias', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = Fastify();
        mocks.resend.mockResolvedValue({ url: 'https://app.test/catalog-view/token', password: 'new-password' });
        mocks.rotatePassword.mockResolvedValue({ url: 'https://app.test/catalog-view/rotated', password: 'rotated-password' });
        mocks.setNotificationsMuted.mockResolvedValue({ id: '123e4567-e89b-42d3-a456-426614174000', customerSnapshot: { notificationsMuted: true } });
        await app.register(wholesaleCatalogRoutes);
        await app.ready();
    });

    afterEach(async () => { await app.close(); });

    it('exposes POST /shares/:id/resend with share permission and activation-compatible body', async () => {
        const response = await app.inject({
            method: 'POST', url: '/shares/123e4567-e89b-42d3-a456-426614174000/resend',
            payload: { subject: '[Catalog] for [Company]', introduction: 'Updated secure link' },
        });
        expect(response.statusCode).toBe(200);
        expect(mocks.resend).toHaveBeenCalledWith('account-1', 'user-1', '123e4567-e89b-42d3-a456-426614174000', {
            subject: '[Catalog] for [Company]', introduction: 'Updated secure link',
        });
        expect(mocks.activate).not.toHaveBeenCalled();
    });

    it('rotates credentials without invoking resend', async () => {
        const response = await app.inject({
            method: 'POST', url: '/shares/123e4567-e89b-42d3-a456-426614174000/rotate-password', payload: {},
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ url: 'https://app.test/catalog-view/rotated', password: 'rotated-password' });
        expect(mocks.rotatePassword).toHaveBeenCalledWith('account-1', 'user-1', '123e4567-e89b-42d3-a456-426614174000', {});
        expect(mocks.resend).not.toHaveBeenCalled();
    });

    it('updates the account-scoped notification preference with share permission', async () => {
        const response = await app.inject({
            method: 'PATCH', url: '/shares/123e4567-e89b-42d3-a456-426614174000/notifications', payload: { muted: true },
        });
        expect(response.statusCode).toBe(200);
        expect(mocks.setNotificationsMuted).toHaveBeenCalledWith('account-1', '123e4567-e89b-42d3-a456-426614174000', true);
        expect(response.json().share.customerSnapshot.notificationsMuted).toBe(true);
    });
});
