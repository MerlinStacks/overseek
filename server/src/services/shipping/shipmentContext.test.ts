import { expect, it } from 'vitest';
import { shipmentAutomationContext } from './shipmentContext';
it('adapts old pending flat tracking payloads without changing their frozen source values', () => {
    const payload = { status: 'processing', shipmentStatus: 'delivered', scanEventDescription: 'Delivered', scanEventOccurredAt: '2026-01-01T00:00:00Z' };
    expect(shipmentAutomationContext(payload)).toMatchObject({ status: 'processing', shipment: { status: 'delivered', latestScanDescription: 'Delivered', latestScanTime: payload.scanEventOccurredAt } });
    expect(payload).not.toHaveProperty('shipment');
});
it('maps callback observation fields and never invents a status from the raw order', () => {
    expect(shipmentAutomationContext({ status: 'processing', trackingNumber: 'TRACK' })).toMatchObject({ shipment: { trackingNumber: 'TRACK', status: undefined } });
    expect(shipmentAutomationContext({ eventStatus: 'in_transit', location: 'Sydney', occurredAt: '2026-01-01T00:00:00Z' })).toMatchObject({ shipment: { status: 'in_transit', latestScanLocation: 'Sydney' } });
});
it('preserves the existing nested shipment contract rather than overwriting it', () => {
    const context = { status: 'processing', shipment: { status: 'delivered' } };
    expect(shipmentAutomationContext(context)).toBe(context);
});
