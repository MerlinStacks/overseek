import { describe, expect, it } from 'vitest';
import { getPayloadWooOrderId, getPayloadWooOrderIdString, parseWooOrderId } from './orderIds';

describe('WooCommerce order IDs', () => {
    it.each([1, 2147483647, '42', ' 0042 '])('accepts supported positive IDs (%s)', value => {
        expect(parseWooOrderId(value)).toBe(Number(value));
    });

    it.each([0, -1, 1.5, NaN, Infinity, 2147483648, Number.MAX_SAFE_INTEGER + 1,
        '0', '2147483648', '9007199254740993', '9'.repeat(400), '', '1e3', '42x', null, true, {}])(
        'rejects invalid or out-of-range IDs (%s)', value => {
            expect(parseWooOrderId(value)).toBeNull();
        }
    );

    it('does not propagate overflowing IDs into tracking payloads', () => {
        expect(getPayloadWooOrderId({ orderId: '9'.repeat(400) })).toBeNull();
        expect(getPayloadWooOrderIdString({ order_id: '9007199254740993' })).toBeNull();
    });

    it('supports both payload names and normalizes valid IDs', () => {
        expect(getPayloadWooOrderId({ order_id: ' 0042 ' })).toBe(42);
        expect(getPayloadWooOrderIdString({ orderId: 42 })).toBe('42');
        expect(getPayloadWooOrderId(null)).toBeNull();
    });
});
