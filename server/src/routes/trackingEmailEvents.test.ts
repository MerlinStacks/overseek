import { describe, expect, it } from 'vitest';
import { normalizeShipmentStatus } from './trackingEmailEvents';

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
