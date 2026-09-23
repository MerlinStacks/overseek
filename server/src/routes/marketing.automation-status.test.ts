import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../utils/prisma';
import { snapshotFixture, snapshotMetadata } from '../services/deliveryEstimates/__tests__/snapshotFixture';

const { mockSetAutomationEnabled, sendEmail } = vi.hoisted(() => ({
    mockSetAutomationEnabled: vi.fn(),
    sendEmail: vi.fn().mockResolvedValue({ messageId: 'test-message' }),
}));
vi.mock('../services/EmailService', () => ({ EmailService: class { sendEmail = sendEmail; } }));
vi.mock('../utils/getDefaultEmailAccount', () => ({ getDefaultEmailAccount: vi.fn().mockResolvedValue({ id: 'sender' }) }));

vi.mock('../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'user-1', accountId: 'acct-1' };
    },
}));

vi.mock('../services/MarketingService', () => {
    class MarketingService {
        listCampaigns = vi.fn();
        createCampaign = vi.fn();
        getCampaign = vi.fn();
        updateCampaign = vi.fn();
        deleteCampaign = vi.fn();
        sendTestEmail = vi.fn();
        listAutomations = vi.fn();
        upsertAutomation = vi.fn();
        getAutomation = vi.fn();
        setAutomationEnabled = mockSetAutomationEnabled;
        getAutomationAnalytics = vi.fn();
        listAutomationEnrollments = vi.fn();
        listAutomationRunEvents = vi.fn();
        deleteAutomation = vi.fn();
        listTemplates = vi.fn();
        upsertTemplate = vi.fn();
        deleteTemplate = vi.fn();
    }

    return { MarketingService };
});

vi.mock('../services/CartRecoveryService', () => ({
    cartRecoveryService: {
        verifyToken: vi.fn(),
        getRecoveryDetails: vi.fn(),
    },
}));

vi.mock('../utils/prisma', () => ({
    prisma: {
        emailAccount: { findFirst: vi.fn() },
        account: { findFirst: vi.fn() },
        wooOrder: { findFirst: vi.fn() },
    },
}));

vi.mock('../utils/accountFeatures', () => ({
    isAccountFeatureEnabled: vi.fn().mockResolvedValue(true),
}));

import marketingRoutes from './marketing';

describe('marketing automation status route', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        app = Fastify();
        await app.register(marketingRoutes, { prefix: '/api/marketing' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
        vi.clearAllMocks();
    });

    it('updates automation status when payload is valid', async () => {
        mockSetAutomationEnabled.mockResolvedValueOnce({
            id: 'auto-1',
            isActive: true,
            status: 'ACTIVE',
        });

        const res = await app.inject({
            method: 'PATCH',
            url: '/api/marketing/automations/auto-1/status',
            payload: { isActive: true },
        });

        expect(res.statusCode).toBe(200);
        expect(mockSetAutomationEnabled).toHaveBeenCalledWith('auto-1', 'acct-1', true);
    });

    it.each([true, false])('standalone test email selects latest persisted snapshot (present=%s)', async present => {
        vi.mocked(prisma.account.findFirst).mockResolvedValue({ wooUrl: 'https://shop.test' } as any);
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue(present ? {
            id: 'internal', number: '42', rawData: { meta_data: snapshotMetadata(null) }, deliveryEstimateSnapshot: snapshotFixture()
        } as any : null);
        const response = await app.inject({ method: 'POST', url: '/api/marketing/test-email', payload: {
            to: 'test@example.com', subject: 'Dates {{order.estimatedDeliveryStart}}', content: '<p>Hello</p>{{delivery_estimate}}'
        } });
        expect(response.statusCode).toBe(200);
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { accountId: 'acct-1' }, orderBy: { dateCreated: 'desc' }, select: expect.objectContaining({ deliveryEstimateSnapshot: true })
        }));
        expect(sendEmail.mock.calls[0][3]).toBe(present ? 'Dates 25 Sept 2026' : 'Dates ');
        expect(sendEmail.mock.calls[0][4]).toEqual(present ? expect.stringContaining('Estimated delivery') : '<p>Hello</p>');
    });

    it('pins the selected internal order in the current tenant even when a newer order exists', async () => {
        const snapshot = snapshotFixture();
        const changedSnapshot = { ...snapshot, delivery: { min: '2026-10-01', max: '2026-10-02' } };
        const selected = { id: 'preview-order', number: '42', rawData: { meta_data: snapshotMetadata(changedSnapshot) }, deliveryEstimateSnapshot: snapshot };
        const newer = { ...selected, id: 'newer-order', deliveryEstimateSnapshot: changedSnapshot };
        vi.mocked(prisma.wooOrder.findFirst).mockImplementation((args: any) => Promise.resolve(
            args.where.accountId === 'acct-1' && args.where.id === 'preview-order' ? selected : newer
        ) as any);
        const response = await app.inject({ method: 'POST', url: '/api/marketing/test-email', payload: {
            to: 'test@example.com', subject: '{{order.estimatedDeliveryStart}}', content: '{{delivery_estimate}}', orderId: 'preview-order'
        } });
        expect(response.statusCode).toBe(200);
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledExactlyOnceWith({
            where: { accountId: 'acct-1', id: 'preview-order' },
            select: { id: true, number: true, status: true, currency: true, total: true, dateCreated: true, rawData: true, deliveryEstimateSnapshot: true }
        });
        expect(sendEmail.mock.calls[0][3]).toBe('25 Sept 2026');
        expect(sendEmail.mock.calls[0][4]).toContain('25 Sept 2026');
        expect(sendEmail.mock.calls[0][4]).not.toContain('Oct');
        expect(selected.deliveryEstimateSnapshot).toEqual(snapshot);
    });

    it('explicit null skips order lookup and blanks delivery content', async () => {
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ deliveryEstimateSnapshot: snapshotFixture() } as any);
        const response = await app.inject({ method: 'POST', url: '/api/marketing/test-email', payload: {
            to: 'test@example.com', subject: 'Dates {{order.estimatedDeliveryStart}}', content: '<p>Hello</p>{{delivery_estimate}}', orderId: null
        } });
        expect(response.statusCode).toBe(200);
        expect(prisma.wooOrder.findFirst).not.toHaveBeenCalled();
        expect(sendEmail.mock.calls[0][3]).toBe('Dates ');
        expect(sendEmail.mock.calls[0][4]).toBe('<p>Hello</p>');
    });

    it.each(['missing-order', 'other-tenant-order'])('returns 404 without sending or falling back for %s', async orderId => {
        const otherTenantOrder = { id: 'other-tenant-order', accountId: 'acct-2', deliveryEstimateSnapshot: snapshotFixture() };
        vi.mocked(prisma.wooOrder.findFirst).mockImplementation((args: any) => Promise.resolve(
            args.where.id === otherTenantOrder.id && args.where.accountId === otherTenantOrder.accountId ? otherTenantOrder : null
        ) as any);
        const response = await app.inject({ method: 'POST', url: '/api/marketing/test-email', payload: {
            to: 'test@example.com', subject: 'Dates', content: '{{delivery_estimate}}', orderId
        } });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ error: 'Order not found' });
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: { accountId: 'acct-1', id: orderId } }));
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it.each([42, false, {}, [], '', '   ', ' padded ', 'x'.repeat(129), 'id\u0000'].map(orderId => ({ orderId })))('rejects invalid orderId %j before querying or sending', async ({ orderId }) => {
        const response = await app.inject({ method: 'POST', url: '/api/marketing/test-email', payload: {
            to: 'test@example.com', subject: 'Dates', content: '{{delivery_estimate}}', orderId
        } });
        expect(response.statusCode).toBe(400);
        expect(prisma.wooOrder.findFirst).not.toHaveBeenCalled();
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('returns 400 when isActive is missing', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/marketing/automations/auto-1/status',
            payload: {},
        });

        expect(res.statusCode).toBe(400);
        expect(mockSetAutomationEnabled).not.toHaveBeenCalled();
    });

    it('returns 404 when automation does not exist', async () => {
        mockSetAutomationEnabled.mockRejectedValueOnce(new Error('Automation not found'));

        const res = await app.inject({
            method: 'PATCH',
            url: '/api/marketing/automations/missing/status',
            payload: { isActive: false },
        });

        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Automation not found' });
    });
});
