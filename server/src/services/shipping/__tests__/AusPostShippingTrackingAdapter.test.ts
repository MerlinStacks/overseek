import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ausPostShippingTrackingAdapter } from '../AusPostShippingTrackingAdapter';
import { prisma } from '../../../utils/prisma';

vi.mock('../../../utils/prisma', () => ({
    prisma: {
        shippingCarrierAccount: {
            findFirst: vi.fn(),
        },
    },
}));

vi.mock('../../../utils/encryption', () => ({
    decrypt: vi.fn(() => JSON.stringify({ apiKey: 'api-key', apiSecret: 'api-secret' })),
}));

describe('AusPostShippingTrackingAdapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) })));
        (prisma.shippingCarrierAccount.findFirst as any).mockResolvedValue({
            credentialsEncrypted: 'encrypted',
            isEnabled: true,
            config: {
                apiEnvironment: 'sandbox',
                apiBaseUrl: 'https://example.test',
                accountNumber: '123456',
                paymentMethod: 'CHARGE_ACCOUNT',
                testEndpointPath: '/test',
                trackingEndpointPath: '/track/{trackingNumber}',
                defaultDomesticService: '7E55',
            },
            senderAddress: {
                name: 'Warehouse',
                company: 'Store Pty Ltd',
                address1: '1 Sender Street',
                suburb: 'Sydney',
                state: 'NSW',
                postcode: '2000',
                phone: '0400000000',
                email: 'dispatch@example.test',
            },
        });
    });

    it('calls configured credential test endpoint with AusPost auth headers', async () => {
        const result = await ausPostShippingTrackingAdapter.testConnection('account-1');

        expect(result.status).toBe('live_test_passed');
        expect(fetch).toHaveBeenCalledWith('https://example.test/test', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                'account-number': '123456',
                Authorization: expect.stringMatching(/^Basic /),
            }),
        }));
    });

    it('extracts tracking events from configured tracking endpoint responses', async () => {
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                trackingEvents: [
                    { eventCode: 'LODGE', description: 'Received by carrier', location: 'Sydney', eventDateTime: '2026-05-19T10:00:00.000Z' },
                ],
            }),
        });

        const events = await ausPostShippingTrackingAdapter.refreshTracking('account-1', 'ABC123');

        expect(fetch).toHaveBeenCalledWith('https://example.test/track/ABC123', expect.any(Object));
        expect(events).toEqual([{ eventCode: 'LODGE', status: 'Received by carrier', description: 'Received by carrier', location: 'Sydney', occurredAt: '2026-05-19T10:00:00.000Z', rawEvent: expect.any(Object) }]);
    });

    it('posts shipment-shaped rate requests using AusPost units and extracts returned prices', async () => {
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                shipments: [{
                    items: [{ product_id: '7E55' }],
                    shipment_summary: { total_cost: '12.34', shipping_cost: '11.22', total_gst: '1.12', status: 'Priced' },
                }],
            }),
        });

        const result = await ausPostShippingTrackingAdapter.getRates('account-1', {
            wooOrderId: 101,
            address: {
                name: 'Jane Buyer',
                company: 'Buyer Co',
                address1: '2 Recipient Road',
                suburb: 'Melbourne',
                state: 'VIC',
                postcode: '3000',
            },
            dimensions: { lengthMm: 220, widthMm: 150, heightMm: 80, weightGrams: 1250 },
            serviceCode: null,
        });

        expect(fetch).toHaveBeenCalledWith('https://example.test/prices/shipments', expect.objectContaining({ method: 'POST' }));
        const [, init] = (fetch as any).mock.calls[0];
        expect(JSON.parse(init.body)).toEqual({
            shipments: [{
                shipment_reference: 'OVERSEEK-101',
                customer_reference_1: 'Woo order 101',
                email_tracking_enabled: false,
                payment_method: 'CHARGE_ACCOUNT',
                from: expect.objectContaining({ type: 'MERCHANT_LOCATION', lines: ['1 Sender Street'], postcode: '2000' }),
                to: expect.objectContaining({ type: 'STANDARD_ADDRESS', lines: ['2 Recipient Road'], postcode: '3000' }),
                items: [{
                    item_reference: 'ORDER-101-1',
                    weight: 1.25,
                    contains_dangerous_goods: false,
                    authority_to_leave: true,
                    product_id: '7E55',
                    length: 22,
                    width: 15,
                    height: 8,
                }],
            }],
        });
        expect(result).toEqual(expect.objectContaining({
            status: 'ok',
            rates: [{ productId: '7E55', totalCost: '12.34', shippingCost: '11.22', totalGst: '1.12', status: 'Priced', raw: expect.any(Object) }],
        }));
    });

    it('validates Australian suburb, state, and postcode combinations', async () => {
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ found: true, results: ['MELBOURNE'] }),
        });

        const result = await ausPostShippingTrackingAdapter.validateAddress('account-1', {
            suburb: 'Melbourne',
            state: 'vic',
            postcode: '3000',
        });

        expect(fetch).toHaveBeenCalledWith('https://example.test/address?suburb=Melbourne&state=VIC&postcode=3000', expect.objectContaining({ method: 'GET' }));
        expect(result).toEqual({ found: true, results: ['MELBOURNE'], rawResponse: { found: true, results: ['MELBOURNE'] } });
    });

    it('posts shipment validation payloads before live label creation', async () => {
        (fetch as any).mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

        const result = await ausPostShippingTrackingAdapter.validateShipment('account-1', {
            wooOrderId: 202,
            order: {},
            senderAddress: {},
            address: {
                name: 'Jane Buyer',
                address1: '2 Recipient Road',
                suburb: 'Melbourne',
                state: 'VIC',
                postcode: '3000',
            },
            dimensions: { lengthMm: 225, widthMm: 155, heightMm: 85, weightGrams: 1260 },
            serviceCode: '7E55',
        });

        expect(result).toEqual({ ok: true, status: 'valid' });
        expect(fetch).toHaveBeenCalledWith('https://example.test/shipments/validation', expect.objectContaining({ method: 'POST' }));
        const [, init] = (fetch as any).mock.calls[0];
        expect(JSON.parse(init.body)).toEqual({
            shipments: [expect.objectContaining({
                shipment_reference: 'OVERSEEK-202',
                payment_method: 'CHARGE_ACCOUNT',
                items: [expect.objectContaining({
                    item_reference: 'ORDER-202-1',
                    product_id: '7E55',
                    weight: 1.26,
                    length: 22.5,
                    width: 15.5,
                    height: 8.5,
                })],
            })],
        });
    });

    it('requires an AusPost service code before shipment validation', async () => {
        (prisma.shippingCarrierAccount.findFirst as any).mockResolvedValueOnce({
            credentialsEncrypted: 'encrypted',
            isEnabled: true,
            config: {
                apiEnvironment: 'sandbox',
                apiBaseUrl: 'https://example.test',
                accountNumber: '123456',
            },
            senderAddress: {
                name: 'Warehouse',
                address1: '1 Sender Street',
                suburb: 'Sydney',
                state: 'NSW',
                postcode: '2000',
            },
        });

        await expect(ausPostShippingTrackingAdapter.validateShipment('account-1', {
            wooOrderId: 203,
            order: {},
            senderAddress: {},
            address: {
                name: 'Jane Buyer',
                address1: '2 Recipient Road',
                suburb: 'Melbourne',
                state: 'VIC',
                postcode: '3000',
            },
            dimensions: { lengthMm: 225, widthMm: 155, heightMm: 85, weightGrams: 1260 },
            serviceCode: null,
        })).rejects.toThrow('AusPost service code is required before validating an AusPost shipment');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('creates shipments and extracts carrier shipment and tracking details', async () => {
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            status: 201,
            text: async () => JSON.stringify({
                shipments: [{
                    shipment_id: 'SHIP-123',
                    shipment_reference: 'OVERSEEK-204',
                    items: [{
                        item_id: 'ITEM-123',
                        product_id: '7E55',
                        tracking_details: {
                            consignment_id: 'CON-123',
                            article_id: 'ABC123456789',
                            barcode_id: 'ABC123456789',
                        },
                    }],
                    shipment_summary: { total_cost: '12.34', total_gst: '1.12', status: 'Created' },
                }],
            }),
        });

        const result = await ausPostShippingTrackingAdapter.createShipment('account-1', {
            wooOrderId: 204,
            order: {},
            senderAddress: {},
            address: {
                name: 'Jane Buyer',
                address1: '2 Recipient Road',
                suburb: 'Melbourne',
                state: 'VIC',
                postcode: '3000',
            },
            dimensions: { lengthMm: 220, widthMm: 150, heightMm: 80, weightGrams: 1250 },
            serviceCode: '7E55',
        });

        expect(fetch).toHaveBeenCalledWith('https://example.test/shipments', expect.objectContaining({ method: 'POST' }));
        expect(result).toEqual(expect.objectContaining({
            status: 'created',
            carrier: 'AUSPOST',
            shipment: {
                carrierShipmentId: 'SHIP-123',
                shipmentReference: 'OVERSEEK-204',
                carrierItemId: 'ITEM-123',
                productId: '7E55',
                trackingNumber: 'ABC123456789',
                consignmentId: 'CON-123',
                articleId: 'ABC123456789',
                barcodeId: 'ABC123456789',
                totalCost: '12.34',
                totalGst: '1.12',
                status: 'Created',
            },
        }));
    });

    it('creates explicit label requests and extracts label request metadata', async () => {
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                message: 'Request actioned',
                code: 'Request actioned',
                labels: [{
                    request_id: 'REQ-123',
                    status: 'AVAILABLE',
                    url: 'https://labels.example.test/REQ-123.pdf',
                    shipment_ids: ['SHIP-123'],
                }],
            }),
        });

        const result = await ausPostShippingTrackingAdapter.createLabelRequest('account-1', {
            shipmentId: 'SHIP-123',
            printGroup: 'Parcel Post',
            layout: 'A6-1pp',
            branded: true,
            waitForLabelUrl: true,
        });

        expect(fetch).toHaveBeenCalledWith('https://example.test/labels', expect.objectContaining({ method: 'POST' }));
        const [, init] = (fetch as any).mock.calls[0];
        expect(JSON.parse(init.body)).toEqual({
            preferences: [{
                type: 'PRINT',
                groups: [{ group: 'Parcel Post', layout: 'A6-1pp', branded: true, left_offset: 0, top_offset: 0 }],
            }],
            shipments: [{ shipment_id: 'SHIP-123' }],
            wait_for_label_url: true,
        });
        expect(result).toEqual(expect.objectContaining({
            status: 'requested',
            carrier: 'AUSPOST',
            labelRequest: {
                requestId: 'REQ-123',
                status: 'AVAILABLE',
                url: 'https://labels.example.test/REQ-123.pdf',
                message: 'Request actioned',
                code: 'Request actioned',
                shipmentIds: ['SHIP-123'],
            },
        }));
    });

    it('fetches label request status and downloads PDF bytes', async () => {
        (fetch as any)
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ labels: [{ request_id: 'REQ-123', status: 'AVAILABLE', url: 'https://labels.example.test/REQ-123.pdf', shipment_ids: ['SHIP-123'] }] }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer,
            });

        const status = await ausPostShippingTrackingAdapter.getLabelRequest('account-1', 'REQ-123');
        const pdf = await ausPostShippingTrackingAdapter.downloadLabelPdf(status.labelRequest.url!);

        expect(fetch).toHaveBeenNthCalledWith(1, 'https://example.test/labels/REQ-123', expect.objectContaining({ method: 'GET' }));
        expect(fetch).toHaveBeenNthCalledWith(2, 'https://labels.example.test/REQ-123.pdf', expect.any(Object));
        expect(status.labelRequest).toEqual({ requestId: 'REQ-123', status: 'AVAILABLE', url: 'https://labels.example.test/REQ-123.pdf', message: null, code: null, shipmentIds: ['SHIP-123'] });
        expect(pdf.equals(Buffer.from([37, 80, 68, 70]))).toBe(true);
    });

    it('uses documented defaults when endpoint paths are not saved', async () => {
        (prisma.shippingCarrierAccount.findFirst as any).mockResolvedValueOnce({
            credentialsEncrypted: 'encrypted',
            isEnabled: true,
            config: { apiEnvironment: 'production', accountNumber: '123456' },
            senderAddress: {},
        });

        const result = await ausPostShippingTrackingAdapter.testConnection('account-1');

        expect(result.status).toBe('live_test_passed');
        expect(fetch).toHaveBeenCalledWith('https://digitalapi.auspost.com.au/shipping/v1/accounts/123456', expect.any(Object));
    });
});
