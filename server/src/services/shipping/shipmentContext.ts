const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Compatibility for already-frozen outbox payloads and storefront tracking
 * callbacks. Never use the raw ORDER status as a shipment milestone. */
export function shipmentAutomationContext(value: unknown): unknown {
    if (!record(value) || record(value.shipment)) return value;
    return { ...value, shipment: {
        trackingNumber: value.trackingNumber, trackingUrl: value.trackingUrl,
        carrier: value.carrier ?? value.provider, serviceName: value.serviceName,
        status: value.shipmentStatus ?? value.eventStatus,
        latestScanDescription: value.scanEventDescription ?? value.description,
        latestScanLocation: value.scanEventLocation ?? value.location,
        latestScanTime: value.scanEventOccurredAt ?? value.occurredAt,
    } };
}
