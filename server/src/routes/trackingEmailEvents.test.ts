import { describe, expect, it } from 'vitest';
import { normalizeShipmentStatus } from './trackingEmailEvents';

describe('normalizeShipmentStatus', () => {
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
