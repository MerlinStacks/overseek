import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/prisma', () => ({
    prisma: {
        account: { findUnique: vi.fn(), findMany: vi.fn() },
        accountFeature: { findUnique: vi.fn(), findMany: vi.fn() },
        emailAccount: { findMany: vi.fn() },
        wooOrder: { findMany: vi.fn() }
    }
}));

vi.mock('../utils/logger', () => ({
    Logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import trackingEmailEventsRoutes, { normalizeShipmentStatus } from './trackingEmailEvents';
import { prisma } from '../utils/prisma';
import { EventBus, EVENTS } from '../services/events';

describe('normalizeShipmentStatus', () => {
    it('normalizes received-by-carrier variants', () => {
        expect(normalizeShipmentStatus('received_by_carrier')).toBe('received_by_carrier');
        expect(normalizeShipmentStatus('Received by carrier')).toBe('received_by_carrier');
        expect(normalizeShipmentStatus(undefined, 'Shipment update', "We've got it")).toBe('received_by_carrier');
    });

    it('normalizes common out-for-delivery variants', () => {
        expect(normalizeShipmentStatus('out_for_delivery')).toBe('out_for_delivery');
        expect(normalizeShipmentStatus('Out for delivery')).toBe('out_for_delivery');
        expect(normalizeShipmentStatus('out-for-delivery')).toBe('out_for_delivery');
        expect(normalizeShipmentStatus('On board for delivery')).toBe('out_for_delivery');
        expect(normalizeShipmentStatus('ON_BOARD_FOR_DELIVERY')).toBe('out_for_delivery');
        expect(normalizeShipmentStatus('ONBOARD_FOR_DELIVERY')).toBe('out_for_delivery');
    });

    it('falls back to event name and description when status is missing', () => {
        expect(normalizeShipmentStatus(undefined, 'Shipment update', 'Parcel is out for delivery')).toBe('out_for_delivery');
    });

    it('prioritizes out-for-delivery over generic delivered text', () => {
        expect(normalizeShipmentStatus('delivered', 'shipment_out_for_delivery', 'On board for delivery, expected to be delivered today')).toBe('out_for_delivery');
    });
});

describe('tracking email event authentication', () => {
    beforeEach(() => {
        vi.mocked(prisma.account.findUnique).mockResolvedValue({
            id: 'account-1',
            wooUrl: 'https://shop.example.com',
            webhookSecret: 'tracking-secret'
        } as any);
        vi.mocked(prisma.accountFeature.findUnique).mockResolvedValue(null);
        vi.mocked(prisma.emailAccount.findMany).mockResolvedValue([]);
    });

    afterEach(() => {
        EventBus.removeAllListeners();
        vi.clearAllMocks();
    });

    it('rejects a resolved account when the bearer token is missing', async () => {
        const fastify = Fastify();
        await fastify.register(trackingEmailEventsRoutes);
        const listener = vi.fn();
        EventBus.on(EVENTS.SHIPMENT.DELIVERED, listener);

        const response = await fastify.inject({
            method: 'POST',
            url: '/account-1',
            payload: { event: { event_status: 'delivered' } }
        });

        expect(response.statusCode).toBe(401);
        expect(listener).not.toHaveBeenCalled();
        await fastify.close();
    });

    it('accepts an account webhook secret as a bearer token', async () => {
        const fastify = Fastify();
        await fastify.register(trackingEmailEventsRoutes);
        const listener = vi.fn();
        EventBus.on(EVENTS.SHIPMENT.DELIVERED, listener);

        const response = await fastify.inject({
            method: 'POST',
            url: '/account-1',
            headers: { authorization: 'Bearer tracking-secret' },
            payload: { event: { event_status: 'delivered' } }
        });

        expect(response.statusCode).toBe(202);
        expect(listener).toHaveBeenCalledOnce();
        await fastify.close();
    });

    it('accepts the configured workflow webhook token', async () => {
        vi.mocked(prisma.account.findUnique).mockResolvedValue({
            id: 'account-1',
            wooUrl: 'https://shop.example.com',
            webhookSecret: null
        } as any);
        vi.mocked(prisma.accountFeature.findUnique).mockResolvedValue({
            config: { webhookAuthToken: 'workflow-secret' }
        } as any);
        const fastify = Fastify();
        await fastify.register(trackingEmailEventsRoutes);

        const response = await fastify.inject({
            method: 'POST',
            url: '/account-1',
            headers: { authorization: 'Bearer workflow-secret' },
            payload: { event: { event_status: 'delivered' } }
        });

        expect(response.statusCode).toBe(202);
        await fastify.close();
    });
});
