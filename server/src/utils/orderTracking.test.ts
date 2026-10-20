import { describe, expect, it } from 'vitest';
import { extractOrderTracking } from './orderTracking';

describe('order tracking normalization', () => {
    it('ignores malformed metadata and unintended scalar coercions', () => {
        expect(extractOrderTracking({ meta_data: [null, 1, {}, { key: 'tracking_number', value: {} }] })).toEqual([]);
        expect(extractOrderTracking(null)).toEqual([]);
    });
    it('normalizes plugin timestamps and custom provider details', () => {
        expect(extractOrderTracking({ meta_data: [{ key: '_wc_shipment_tracking_items', value: [{ tracking_number: ' 00123 ', tracking_provider: '', custom_tracking_provider: 'Carrier', custom_tracking_link: 'https://carrier.test/track/123', date_shipped: '1700000000' }] }] })).toEqual([
            { provider: 'Carrier', trackingNumber: '00123', trackingUrl: 'https://carrier.test/track/123', dateShipped: '2023-11-14T22:13:20.000Z' }
        ]);
    });
    it.each(['javascript:alert(1)', 'data:text/html,unsafe', '//carrier.test/track', 'https://user:password@carrier.test/track'])('rejects unsafe tracking link %s', link => {
        expect(extractOrderTracking({ meta_data: [{ key: 'tracking_number', value: '123' }, { key: 'tracking_url', value: link }] })[0].trackingUrl).toBeNull();
    });
    it('keeps valid fallback numbers and rejects invalid dates', () => {
        expect(extractOrderTracking({ meta_data: [{ key: '_wc_shipment_tracking_items', value: [{ tracking_number: 123, date_shipped: 'invalid' }] }] })[0]).toMatchObject({ trackingNumber: '123', dateShipped: null });
    });
});
