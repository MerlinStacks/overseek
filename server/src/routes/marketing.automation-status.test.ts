import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../utils/prisma';
import { snapshotFixture, snapshotMetadata } from '../services/deliveryEstimates/__tests__/snapshotFixture';

const { mockSetAutomationEnabled, mockListAutomations, sendEmail } = vi.hoisted(() => ({
    mockSetAutomationEnabled: vi.fn(),
    mockListAutomations: vi.fn().mockResolvedValue([]),
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
        listAutomations = mockListAutomations;
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
vi.mock('../services/PermissionService', () => ({ PermissionService: { hasPermission: vi.fn().mockResolvedValue(true) } }));

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

    it.each([undefined, '7', '30', '365'])('passes the optional period to flow metrics (%s)', async days => {
        const res = await app.inject({
            method: 'GET', url: `/api/marketing/automations${days ? `?days=${days}` : ''}`
        });
        expect(res.statusCode).toBe(200);
        expect(mockListAutomations).toHaveBeenCalledWith('acct-1', days ? Number(days) : undefined);
    });

    it.each(['0', '-1', '1.5', '366', 'nope', 'Infinity', ''])('rejects invalid flow periods (%s)', async days => {
        const res = await app.inject({ method: 'GET', url: `/api/marketing/automations?days=${days}` });
        expect(res.statusCode).toBe(400);
        expect(mockListAutomations).not.toHaveBeenCalled();
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

    it('preserves preference placeholders for recipient-specific resolution by the sender', async () => {
        vi.mocked(prisma.account.findFirst).mockResolvedValue({ wooUrl: 'https://shop.test' } as any);
        const response = await app.inject({ method: 'POST', url: '/api/marketing/test-email', payload: {
            to: 'test@example.com', subject: 'Hello', orderId: null,
            content: '<a href="https://{{unsubscribe_url}}">Unsubscribe</a><a href="https://%7B%7Bpreferences_url%7D%7D">Preferences</a>'
        } });
        expect(response.statusCode).toBe(200);
        expect(sendEmail.mock.calls[0][4]).toContain('{{unsubscribe_url}}');
        expect(sendEmail.mock.calls[0][4]).toContain('{{preferences_url}}');
        expect(sendEmail.mock.calls[0][4]).not.toContain('shop.test');
        expect(sendEmail.mock.calls[0][6]).toMatchObject({ category: 'MARKETING' });
    });

    it('explains unsubscribe suppression for a test send', async () => {
        sendEmail.mockResolvedValueOnce({ skipped: true, reason: 'unsubscribed_all' });
        const response = await app.inject({ method: 'POST', url: '/api/marketing/test-email', payload: {
            to: 'test@example.com', subject: 'Hello', content: '<p>Hello</p>', orderId: null
        } });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ reason: 'unsubscribed_all', error: expect.stringContaining('has unsubscribed') });
    });

    it('fills cart tags in both preview and test using the same selected order', async () => {
        vi.mocked(prisma.account.findFirst).mockResolvedValue({ wooUrl: 'https://shop.test', currency: 'AUD' } as any);
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({
            id: 'cart-order', number: '42', total: '75.00', currency: 'AUD',
            rawData: { billing: { first_name: 'Emily' }, line_items: [{ name: 'Custom mug', quantity: 3, total: '75.00' }] },
        } as any);
        const content = '<p>Hello {{customer.firstName}}</p>{{cart.itemsTable}}<b>{{cart.total}} {{cart.currency}}</b><a href="{{cart.recoveryUrl}}">Return</a>';
        const preview = await app.inject({ method: 'POST', url: '/api/marketing/preview-email', payload: { subject: 'Hello {{customer.firstName}}', content } });
        expect(preview.statusCode).toBe(200);
        expect(preview.json()).toMatchObject({ subject: 'Hello Emily', orderId: 'cart-order' });
        expect(preview.json().html).toContain('Custom mug');
        expect(preview.json().html).toContain('75.00');
        expect(preview.json().canonicalHtml).toContain('https://shop.test/checkout/?recover_cart=preview');
        expect(preview.json().html).toContain(encodeURIComponent('https://shop.test/checkout/?recover_cart=preview'));
        expect(preview.json().html).not.toContain('{{');
        expect(sendEmail).not.toHaveBeenCalled();
        const test = await app.inject({ method: 'POST', url: '/api/marketing/test-email', payload: { to: 'test@example.com', subject: 'Hello {{customer.firstName}}', content, orderId: preview.json().orderId } });
        expect(test.statusCode).toBe(200);
        expect(sendEmail.mock.calls[0][4]).toBe(preview.json().canonicalHtml);
    });

    it('previews configured sender and UTM values before tracking and sends the same canonical content', async () => {
        vi.mocked(prisma.account.findFirst).mockResolvedValue({ wooUrl: 'https://shop.test' } as any);
        const deliveryOptions = { appendUtm: true, campaignName: 'Spring gifts', overrideFrom: true, fromName: 'Shop {{customer.firstName}}', fromEmail: 'sales@shop.test', replyToEmail: 'help@shop.test' };
        const preview = await app.inject({ method: 'POST', url: '/api/marketing/preview-email', payload: { subject: 'Test', content: '<a href="https://shop.test/gifts?a=1&amp;b=2">Shop</a>', orderId: null, deliveryOptions } });
        expect(preview.statusCode).toBe(200);
        const artifact = preview.json();
        expect(artifact.sender).toMatchObject({ fromName: 'Shop Test', fromEmail: 'sales@shop.test', replyToEmail: 'help@shop.test' });
        expect(artifact.canonicalHtml).toContain('utm_campaign=Spring+gifts');
        expect(artifact.html).toContain('utm_campaign%3DSpring%2Bgifts');
        const test = await app.inject({ method: 'POST', url: '/api/marketing/test-email', payload: { to: 'qa@example.com', subject: artifact.subject, content: artifact.canonicalHtml, orderId: null, deliveryOptions: { overrideFrom: true, ...artifact.sender, appendUtm: false } } });
        expect(test.statusCode).toBe(200);
        expect(sendEmail.mock.calls[0][4]).toBe(artifact.canonicalHtml);
        expect(sendEmail.mock.calls[0][6]).toMatchObject(artifact.sender);
    });

    it('uses sample cart items when no order exists, without sending a preview', async () => {
        vi.mocked(prisma.account.findFirst).mockResolvedValue({ wooUrl: 'https://shop.test' } as any);
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue(null);
        const response = await app.inject({ method: 'POST', url: '/api/marketing/preview-email', payload: { content: '{{cart.itemsTable}} {{cart.total}} {{cart.currency}}' } });
        expect(response.statusCode).toBe(200);
        expect(response.json().html).toContain('Sample product');
        expect(response.json().html).not.toContain('{{');
        expect(sendEmail).not.toHaveBeenCalled();
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
