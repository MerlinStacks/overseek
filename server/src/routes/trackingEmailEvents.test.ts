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
    });

    it('falls back to event name and description when status is missing', () => {
        expect(normalizeShipmentStatus(undefined, 'Shipment update', 'Parcel is out for delivery')).toBe('out_for_delivery');
    });
});
