import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingTrackingService } from '../ShippingTrackingService';
import { prisma } from '../../../utils/prisma';
import { ausPostShippingTrackingAdapter } from '../AusPostShippingTrackingAdapter';
import { automationEngine } from '../../AutomationEngine';

vi.mock('../../../utils/prisma', () => ({
    prisma: {
        shippingLabel: {
            findFirst: vi.fn(),
            update: vi.fn(),
        },
        shippingTrackingEvent: {
            upsert: vi.fn(),
            update: vi.fn(),
        },
        shippingAutomationDispatch: {
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
        },
        shippingAuditEvent: {
            create: vi.fn(),
        },
        shippingCarrierAccount: {
            findFirst: vi.fn(),
        },
        wooOrder: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock('../AusPostShippingTrackingAdapter', () => ({
    ausPostShippingTrackingAdapter: {
        refreshTracking: vi.fn(),
    },
}));

vi.mock('../../AutomationEngine', () => ({
    automationEngine: {
        processTrigger: vi.fn(),
    },
}));

vi.mock('../../../utils/logger', () => ({
    Logger: {
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe('ShippingTrackingService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.shippingLabel.findFirst as any).mockImplementation((args: any) => Promise.resolve({
            id: 'label-1',
            accountId: 'account-1',
            carrier: 'AUSPOST',
            trackingNumber: 'ABC123',
            wooOrderId: 1001,
            orderId: 'order-1',
            trackingUrl: 'https://track.example/ABC123',
            trackingEvents: args?.include?.trackingEvents ? [{ id: 'event-1', description: 'Received by Australia Post' }] : undefined,
        }));
        (prisma.shippingTrackingEvent.upsert as any).mockImplementation(({ create }: any) => Promise.resolve({ id: 'event-1', ...create }));
        (prisma.shippingLabel.update as any).mockResolvedValue({});
        (prisma.shippingAutomationDispatch.findUnique as any).mockResolvedValue({ id: 'existing-dispatch' });
        (prisma.shippingCarrierAccount.findFirst as any).mockResolvedValue({
            config: { trackingAutomationAllowlist: ['SHIPMENT_RECEIVED_BY_CARRIER'] },
        });
    });

    it('normalizes received-by-carrier events and updates label tracking summary', async () => {
        await shippingTrackingService.recordTrackingEvent('account-1', 'label-1', {
            eventCode: 'AUS_LODGED',
            description: 'Received by Australia Post',
            location: 'Melbourne',
            occurredAt: '2026-05-19T10:00:00.000Z',
        });

        expect(prisma.shippingTrackingEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({
                normalizedState: 'received_by_carrier',
                normalizedMilestone: 'received_by_carrier',
            }),
            create: expect.objectContaining({
                normalizedState: 'received_by_carrier',
                normalizedMilestone: 'received_by_carrier',
                eventCode: 'AUS_LODGED',
                location: 'Melbourne',
            }),
        }));
        expect(prisma.shippingLabel.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'label-1', accountId: 'account-1' },
            data: expect.objectContaining({ latestTrackingStatus: 'received_by_carrier' }),
        }));
    });

    it('imports events returned by the AusPost adapter refresh path', async () => {
        (ausPostShippingTrackingAdapter.refreshTracking as any).mockResolvedValue([
            { eventCode: 'IN_TRANSIT', description: 'In transit', occurredAt: '2026-05-19T11:00:00.000Z', rawEvent: { status: 'moving' } },
        ]);

        const result = await shippingTrackingService.refreshTrackingFromCarrier('account-1', 'label-1');

        expect(result).toEqual(expect.objectContaining({ labelId: 'label-1', trackingNumber: 'ABC123', eventsImported: 1 }));
        expect(ausPostShippingTrackingAdapter.refreshTracking).toHaveBeenCalledWith('account-1', 'ABC123');
        expect(prisma.shippingTrackingEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ normalizedState: 'in_transit' }),
        }));
    });

    it('does not dispatch customer automation when trigger is not allowlisted', async () => {
        (prisma.shippingCarrierAccount.findFirst as any).mockResolvedValue({ config: { trackingAutomationAllowlist: [] } });

        await shippingTrackingService.recordTrackingEvent('account-1', 'label-1', {
            eventCode: 'DELIVERED',
            description: 'Delivered',
            occurredAt: '2026-05-19T12:00:00.000Z',
        });

        expect(prisma.shippingAutomationDispatch.create).not.toHaveBeenCalled();
    });

    it('dispatches delivered automation by default when no allowlist is configured', async () => {
        (prisma.shippingCarrierAccount.findFirst as any).mockResolvedValueOnce({ config: {} });
        (prisma.shippingLabel.findFirst as any).mockImplementation((args: any) => Promise.resolve({
            id: 'label-1',
            accountId: 'account-1',
            carrier: 'AUSPOST',
            trackingNumber: 'ABC123',
            wooOrderId: 1001,
            orderId: 'order-1',
            trackingUrl: 'https://track.example/ABC123',
            trackingEvents: args?.include?.trackingEvents ? [{
                id: 'event-1',
                eventCode: 'DELIVERED',
                normalizedState: 'delivered',
                status: 'delivered',
                description: 'Delivered',
                location: 'Melbourne',
                occurredAt: new Date('2026-05-19T12:00:00.000Z'),
            }] : undefined,
        }));
        (prisma.wooOrder.findUnique as any).mockResolvedValue({
            id: 'order-1',
            wooId: 1001,
            number: '1001',
            billingEmail: 'customer@example.com',
            rawData: { billing: { email: 'customer@example.com', first_name: 'Jane', last_name: 'Smith' } },
        });
        (prisma.shippingAutomationDispatch.findUnique as any).mockResolvedValue(null);
        (prisma.shippingAutomationDispatch.create as any).mockResolvedValue({});
        (prisma.shippingAutomationDispatch.update as any).mockResolvedValue({});
        (prisma.shippingTrackingEvent.update as any).mockResolvedValue({});

        await shippingTrackingService.recordTrackingEvent('account-1', 'label-1', {
            eventCode: 'DELIVERED',
            description: 'Delivered',
            occurredAt: '2026-05-19T12:00:00.000Z',
        });

        expect(automationEngine.processTrigger).toHaveBeenCalledWith('account-1', 'SHIPMENT_DELIVERED', expect.objectContaining({
            email: 'customer@example.com',
            trackingNumber: 'ABC123',
            shipmentStatus: 'delivered',
        }));
    });

    it('normalizes terminal and exception tracking states', () => {
        expect(shippingTrackingService.normalizeTrackingEvent({ description: 'Delivered' })).toMatchObject({ normalizedState: 'delivered', terminal: true });
        expect(shippingTrackingService.normalizeTrackingEvent({ description: 'Return to sender' })).toMatchObject({ normalizedState: 'returned', terminal: true });
        expect(shippingTrackingService.normalizeTrackingEvent({ description: 'Cancelled by carrier' })).toMatchObject({ normalizedState: 'cancelled', terminal: true });
        expect(shippingTrackingService.normalizeTrackingEvent({ description: 'Delayed due to address issue' })).toMatchObject({ normalizedState: 'exception' });
    });

    it('normalizes machine-form out-for-delivery carrier statuses', () => {
        expect(shippingTrackingService.normalizeTrackingEvent({ status: 'ON_BOARD_FOR_DELIVERY' })).toMatchObject({
            normalizedState: 'out_for_delivery',
            triggerType: 'SHIPMENT_OUT_FOR_DELIVERY',
        });
        expect(shippingTrackingService.normalizeTrackingEvent({ eventCode: 'ONBOARD_FOR_DELIVERY' })).toMatchObject({
            normalizedState: 'out_for_delivery',
            triggerType: 'SHIPMENT_OUT_FOR_DELIVERY',
        });
        expect(shippingTrackingService.normalizeTrackingEvent({ description: 'On board for delivery, expected to be delivered today' })).toMatchObject({
            normalizedState: 'out_for_delivery',
            triggerType: 'SHIPMENT_OUT_FOR_DELIVERY',
        });
    });
});
