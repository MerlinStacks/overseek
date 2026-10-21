import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetaCAPIService } from '../MetaCAPIService';

// Mock prisma
vi.mock('../../../utils/prisma', () => ({
    prisma: {
        conversionDelivery: {
            create: vi.fn().mockResolvedValue({ id: 'delivery-1' }),
            update: vi.fn().mockResolvedValue({}),
        },
    },
}));

vi.mock('../../../utils/logger', () => ({
    Logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../../utils/prisma';

// Mock fetch globally
global.fetch = vi.fn();

describe('MetaCAPIService', () => {
    const service = new MetaCAPIService();
    const accountId = 'test-account';
    const config = { pixelId: 'px-123', accessToken: 'tok-abc', testEventCode: 'TEST123', advancedMatching: true };
    const session = { id: 'sess-1', email: 'user@example.com', ipAddress: '1.2.3.4', userAgent: 'Mozilla', country: 'AU' };

    const purchaseData: any = {
        accountId,
        visitorId: 'vis-1',
        type: 'purchase',
        url: 'https://store.com/order-received',
        eventId: 'evt-uuid-1',
        payload: {
            orderId: 100,
            total: 59.99,
            currency: 'AUD',
            email: 'buyer@test.com',
            items: [{ id: '10', sku: 'SKU1', name: 'Widget', quantity: 2, price: 29.99 }],
            fbc: 'fb.1.123',
            fbp: 'fb.1.456',
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => '{"events_received": 1}',
        });
    });

    it('should use Meta Graph API v25.0', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const url = (global.fetch as any).mock.calls[0][0] as string;
        expect(url).toContain('v25.0');
        expect(url).toContain('px-123');
    });

    it('should hash email in user_data using SHA-256', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const userData = body.data[0].user_data;

        // Email should be hashed, not plaintext
        expect(userData.em).toBeDefined();
        expect(userData.em).not.toBe('buyer@test.com');
        expect(userData.em).toHaveLength(64); // SHA-256 hex = 64 chars
    });

    it('should include fbc and fbp cookies when present', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const userData = body.data[0].user_data;

        expect(userData.fbc).toBe('fb.1.123');
        expect(userData.fbp).toBe('fb.1.456');
    });

    it('Google braid and GA session context do not change Meta purchase payloads or deduplication', async () => {
        const data = { ...purchaseData, occurredAt: '2026-10-21T12:00:00Z' };
        await service.sendEvent(accountId, config, data, session);
        const originalBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        await service.sendEvent(accountId, config, {
            ...data, clickId: 'google-private-click', clickPlatform: 'google', clickIdType: 'wbraid',
            payload: { ...data.payload, gaSessionIds: { STREAM: '1770000123' } },
        }, session);
        const enrichedBody = JSON.parse((global.fetch as any).mock.calls[1][1].body);
        expect(enrichedBody).toEqual(originalBody);
        expect(enrichedBody.data[0].event_id).toBe(purchaseData.eventId);
    });

    it('should construct fbc from a top-level Facebook click ID', async () => {
        const viewData = {
            ...purchaseData,
            type: 'product_view',
            clickId: 'meta-click-id',
            clickPlatform: 'facebook',
            payload: { items: [{ id: 10, sku: 'SKU1', price: 20 }] },
        };

        await service.sendEvent(accountId, config, viewData, session);

        const userData = JSON.parse((global.fetch as any).mock.calls[0][1].body).data[0].user_data;
        expect(userData.fbc).toMatch(/^fb\.1\.\d+\.meta-click-id$/);
    });

    it('should include ViewContent identity and normalize phone before hashing', async () => {
        const viewData = {
            ...purchaseData,
            type: 'product_view',
            payload: {
                externalId: 'visitor-123',
                email: 'viewer@example.com',
                billingPhone: '0412 345 678',
                billingCountry: 'AU',
                billingFirst: 'Jane',
                billingLast: 'Doe',
                billingCity: 'Sydney',
                billingState: 'NSW',
                billingZip: '2000',
                items: [{ id: 10, sku: 'SKU1', price: 20 }],
            },
        };

        await service.sendEvent(accountId, config, viewData, null);

        const userData = JSON.parse((global.fetch as any).mock.calls[0][1].body).data[0].user_data;
        expect(userData.em).toHaveLength(64);
        // Meta hashes the normalized phone without a leading plus sign.
        expect(userData.ph).toBe('222e24d90b23ba2af558a2891bfa399f19a7eb9f33df34a7d6809b97c5a97246');
        expect(userData.external_id).toHaveLength(64);
        expect(userData.fn).toHaveLength(64);
        expect(userData.ln).toHaveLength(64);
        expect(userData.ct).toHaveLength(64);
        expect(userData.st).toHaveLength(64);
        expect(userData.zp).toHaveLength(64);
        expect(userData.country).toHaveLength(64);
    });

    it('should include hashed external_id when customerId is in payload', async () => {
        const dataWithCustomer = {
            ...purchaseData,
            payload: { ...purchaseData.payload, customerId: 42 },
        };
        await service.sendEvent(accountId, config, dataWithCustomer, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const userData = body.data[0].user_data;

        // SHA-256('wc_42')
        expect(userData.external_id).toBe('273e5904d9210e4b0df8ade46146f166a9d7ac7fa61b857cd429ce1a99ba0ec0');
    });

    it('should use externalId from payload when explicitly provided', async () => {
        const dataWithExternalId = {
            ...purchaseData,
            payload: { ...purchaseData.payload, externalId: 'custom-ext-123' },
        };
        await service.sendEvent(accountId, config, dataWithExternalId, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const userData = body.data[0].user_data;

        expect(userData.external_id).toBe('7372a5106b48ca67e297f0051ecb3eb538dab1afec82344555634f29df54c2a4');
    });

    it('should apply contentIdFormat=sku by default for custom_data contents', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const contents = body.data[0].custom_data.contents;

        // Default format is 'sku', item has sku 'SKU1'
        expect(contents[0].id).toBe('SKU1');
    });

    it('should prefer canonical contentId over configured SKU formatting', async () => {
        const data = {
            ...purchaseData,
            payload: { ...purchaseData.payload, items: [{ contentId: 'canonical-10', id: '10', sku: 'SKU1' }] },
        };

        await service.sendEvent(accountId, { ...config, contentIdPrefix: 'prefix-' }, data, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].custom_data.contents[0].id).toBe('canonical-10');
    });

    it('should use the immutable occurrence time for event_time and generated fbc', async () => {
        const data = {
            ...purchaseData,
            occurredAt: '2025-02-03T04:05:06.000Z',
            clickId: 'top-level-click',
            clickPlatform: 'META',
            payload: { ...purchaseData.payload, clickId: 'stale-click', clickPlatform: 'tiktok', fbc: undefined },
        };

        await service.sendEvent(accountId, config, data, session);

        const event = JSON.parse((global.fetch as any).mock.calls[0][1].body).data[0];
        expect(event.event_time).toBe(1738555506);
        expect(event.user_data.fbc).toBe('fb.1.1738555506000.top-level-click');
    });

    it('should omit optional PII when advanced matching is disabled', async () => {
        await service.sendEvent(accountId, { ...config, advancedMatching: false }, purchaseData, session);

        const userData = JSON.parse((global.fetch as any).mock.calls[0][1].body).data[0].user_data;
        expect(userData).toEqual({
            client_ip_address: '1.2.3.4',
            client_user_agent: 'Mozilla',
            fbc: 'fb.1.123',
            fbp: 'fb.1.456',
        });
    });

    it('should apply Meta-only shipping and tax exclusions to server purchase value', async () => {
        const data = {
            ...purchaseData,
            payload: { ...purchaseData.payload, total: 100, shipping: 10, tax: 15 },
        };

        await service.sendEvent(
            accountId,
            { ...config, excludeShipping: true, excludeTax: true },
            data,
            session,
        );

        const event = JSON.parse((global.fetch as any).mock.calls[0][1].body).data[0];
        expect(event.custom_data.value).toBe(75);
    });

    it('should apply contentIdFormat=id with prefix/suffix from config', async () => {
        const customConfig = {
            ...config,
            contentIdFormat: 'id',
            contentIdPrefix: 'OS-',
            contentIdSuffix: '-AU',
        };
        await service.sendEvent(accountId, customConfig, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const contents = body.data[0].custom_data.contents;

        expect(contents[0].id).toBe('OS-10-AU');
    });

    it.each([undefined, null, '', ' ', 'not-a-price', '1,234.50', NaN, Infinity, -10, true])(
        'does not send or retry a Purchase with invalid total %s', async total => {
            await service.sendEvent(accountId, config, { ...purchaseData, payload: { ...purchaseData.payload, total } }, session);
            expect(global.fetch).not.toHaveBeenCalled();
            expect(prisma.conversionDelivery.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: 'FAILED', attempts: 0, lastError: expect.stringContaining('NON_RETRYABLE:') }),
            }));
        },
    );

    it.each([undefined, null, '', 'AU', 'Australian dollars', 'ZZZ', 123])(
        'does not send a Purchase with invalid currency %s', async currency => {
            await service.sendEvent(accountId, config, { ...purchaseData, payload: { ...purchaseData.payload, currency } }, session);
            expect(global.fetch).not.toHaveBeenCalled();
        },
    );

    it('normalizes a numeric string and currency without replacing legitimate zero revenue', async () => {
        for (const total of ['42.50', 0]) {
            await service.sendEvent(accountId, config, { ...purchaseData, payload: { ...purchaseData.payload, total, currency: ' aud ' } }, session);
            const event = JSON.parse((global.fetch as any).mock.lastCall[1].body).data[0];
            expect(event.custom_data).toMatchObject({ value: Number(total), currency: 'AUD' });
        }
    });

    it.each(['bad', -1, Infinity, '', null])('rejects an invalid enabled shipping deduction %s', async shipping => {
        await service.sendEvent(accountId, { ...config, excludeShipping: true }, {
            ...purchaseData, payload: { ...purchaseData.payload, shipping },
        }, session);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not clamp inconsistent order deductions to a fabricated zero purchase value', async () => {
        await service.sendEvent(accountId, { ...config, excludeShipping: true }, {
            ...purchaseData, payload: { ...purchaseData.payload, total: 20, shipping: 30 },
        }, session);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('keeps a legitimate zero after decimal shipping and tax deductions', async () => {
        await service.sendEvent(accountId, { ...config, excludeShipping: true, excludeTax: true }, {
            ...purchaseData, payload: { ...purchaseData.payload, total: 0.3, shipping: 0.1, tax: 0.2 },
        }, session);
        expect(JSON.parse((global.fetch as any).mock.lastCall[1].body).data[0].custom_data.value).toBe(0);
    });

    it('uses added item price times quantity, not the cart total or purchase exclusions', async () => {
        await service.sendEvent(accountId, { ...config, excludeShipping: true, excludeTax: true }, {
            ...purchaseData, type: 'add_to_cart',
            payload: { ...purchaseData.payload, total: 300, price: '12.50', quantity: 3, shipping: 5, tax: 10 },
        }, session);
        const event = JSON.parse((global.fetch as any).mock.lastCall[1].body).data[0];
        expect(event.event_name).toBe('AddToCart');
        expect(event.event_id).toBe(purchaseData.eventId);
        expect(event.custom_data.value).toBe(37.5);
    });

    it('preserves different real order totals', async () => {
        for (const total of [25, 79.95, 123.45]) {
            await service.sendEvent(accountId, config, { ...purchaseData, payload: { ...purchaseData.payload, total } }, session);
            expect(JSON.parse((global.fetch as any).mock.lastCall[1].body).data[0].custom_data.value).toBe(total);
        }
    });

    it('supports item-only AddToCart payloads without substituting the cart total', async () => {
        await service.sendEvent(accountId, config, {
            ...purchaseData, type: 'add_to_cart',
            payload: { ...purchaseData.payload, total: 300, items: [{ id: 1, price: '7.50', quantity: 2 }] },
        }, session);
        expect(JSON.parse((global.fetch as any).mock.lastCall[1].body).data[0].custom_data.value).toBe(15);
    });

    it('should fall back to item id when sku is missing and format=sku', async () => {
        const noSkuData = {
            ...purchaseData,
            payload: {
                ...purchaseData.payload,
                items: [{ id: 99, name: 'No SKU', quantity: 1, price: 10 }],
            },
        };
        await service.sendEvent(accountId, config, noSkuData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        const contents = body.data[0].custom_data.contents;

        expect(contents[0].id).toBe('99');
    });

    it('should include test_event_code when configured', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.test_event_code).toBe('TEST123');
    });

    it('should map purchase to Purchase event name', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].event_name).toBe('Purchase');
    });

    it('should include custom_data with value and currency', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
        expect(body.data[0].custom_data.value).toBe(59.99);
        expect(body.data[0].custom_data.currency).toBe('AUD');
        expect(body.data[0].custom_data.contents).toHaveLength(1);
    });

    it('should log delivery to ConversionDelivery model', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        expect(prisma.conversionDelivery.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    accountId,
                    platform: 'META',
                    eventName: 'Purchase',
                    eventId: 'evt-uuid-1',
                    status: 'PENDING',
                }),
            })
        );

        // Should update to SENT after successful delivery
        expect(prisma.conversionDelivery.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'SENT' }),
            })
        );
    });

    it('should skip when pixelId is missing', async () => {
        await service.sendEvent(accountId, { accessToken: 'tok' }, purchaseData, session);

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should skip non-conversion events', async () => {
        const pageviewData = { ...purchaseData, type: 'pageview' };
        await service.sendEvent(accountId, config, pageviewData, session);

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should mark delivery as FAILED on HTTP error', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: false,
            status: 400,
            text: async () => '{"error": "Invalid pixel"}',
        });

        await service.sendEvent(accountId, config, purchaseData, session);

        expect(prisma.conversionDelivery.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'FAILED', httpStatus: 400 }),
            })
        );
    });

    it('should mark a response-level Meta error as FAILED', async () => {
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ error: { code: 100, message: 'Invalid parameter' } }),
        });

        await service.sendEvent(accountId, config, purchaseData, session);

        expect(prisma.conversionDelivery.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'FAILED', lastError: 'Invalid parameter' }),
            }),
        );
    });

    it('should attach a request timeout signal', async () => {
        await service.sendEvent(accountId, config, purchaseData, session);

        expect((global.fetch as any).mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });
});
