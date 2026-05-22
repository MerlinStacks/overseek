import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingFulfillmentService } from '../ShippingFulfillmentService';
import { prisma } from '../../../utils/prisma';
import { WooService } from '../../woo';

const updateOrderMock = vi.fn();
const createOrderNoteMock = vi.fn();

vi.mock('../../../utils/prisma', () => ({
    prisma: {
        shippingLabel: {
            findFirst: vi.fn(),
        },
        wooOrder: {
            findUnique: vi.fn(),
            update: vi.fn(),
        },
    },
}));

vi.mock('../../woo', () => ({
    WooService: {
        forAccount: vi.fn(),
    },
}));

vi.mock('../../../utils/logger', () => ({
    Logger: {
        warn: vi.fn(),
    },
}));

describe('ShippingFulfillmentService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        updateOrderMock.mockResolvedValue({});
        createOrderNoteMock.mockResolvedValue({});
        (WooService.forAccount as any).mockResolvedValue({
            updateOrder: updateOrderMock,
            createOrderNote: createOrderNoteMock,
        });
        (prisma.shippingLabel.findFirst as any).mockResolvedValue({
            id: 'label-1',
            accountId: 'acct-1',
            wooOrderId: 123,
            carrier: 'AUSPOST',
            serviceCode: 'AUS_PARCEL_EXPRESS',
            serviceName: 'Express Post',
            trackingNumber: 'TRACK123',
            trackingUrl: 'https://tracking.example/TRACK123',
            costAmount: 9.99,
            costCurrency: 'AUD',
        });
        (prisma.wooOrder.findUnique as any).mockResolvedValue({
            id: 'order-db-1',
            accountId: 'acct-1',
            wooId: 123,
            status: 'processing',
            rawData: {
                shipping_lines: [{ method_title: 'Flat Rate', method_id: 'flat_rate:1' }],
                meta_data: [{ key: '_some_existing_key', value: 'abc' }],
            },
        });
        (prisma.wooOrder.update as any).mockResolvedValue({});
    });

    it('syncs fulfillment metadata without overwriting Woo shipping lines', async () => {
        await shippingFulfillmentService.syncPrintedLabel('acct-1', 'label-1');

        expect(updateOrderMock).toHaveBeenCalledWith(123, expect.objectContaining({
            status: 'completed',
            meta_data: expect.any(Array),
        }));
        expect(updateOrderMock).toHaveBeenCalledWith(123, expect.not.objectContaining({
            shipping_lines: expect.anything(),
        }));

        expect(prisma.wooOrder.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'order-db-1' },
            data: expect.objectContaining({
                rawData: expect.objectContaining({
                    shipping_lines: [{ method_title: 'Flat Rate', method_id: 'flat_rate:1' }],
                }),
            }),
        }));
    });

    it('does not push line items or shipping totals during fulfillment sync', async () => {
        await shippingFulfillmentService.syncPrintedLabel('acct-1', 'label-1');

        expect(updateOrderMock).toHaveBeenCalledWith(123, expect.not.objectContaining({
            line_items: expect.anything(),
        }));
        expect(updateOrderMock).toHaveBeenCalledWith(123, expect.not.objectContaining({
            shipping_total: expect.anything(),
        }));
    });
});
