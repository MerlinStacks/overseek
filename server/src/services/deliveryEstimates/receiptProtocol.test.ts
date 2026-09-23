import { describe, expect, it } from 'vitest';
import { parseReceiptAck } from './receiptProtocol';

const operation = { operationId: 'a_10_1', sequence: 1, productWooId: 10, variationWooId: null, stockOwnerWooId: 10, delta: 3 };
const ack = { schemaVersion: 1, operationId: operation.operationId, sequence: 1, stockOwnerWooId: 10, guardActive: true, receiptSafety: 'unverified' };
describe('receipt ACK state/quantity contract', () => {
    it.each([0, -1, 1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])('accepts applied safe integer %s', stockQuantity => {
        expect(parseReceiptAck({ ...ack, state: 'applied', stockQuantity }, operation)).not.toBeNull();
    });
    it.each([null, 0.5, -1.5, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, NaN, Infinity, '1'])('rejects applied quantity %s', stockQuantity => {
        expect(parseReceiptAck({ ...ack, state: 'applied', stockQuantity }, operation)).toBeNull();
    });
    it.each(['prepared', 'uncertain'])('%s requires exactly null stockQuantity', state => {
        expect(parseReceiptAck({ ...ack, state, stockQuantity: null }, operation)).not.toBeNull();
        for (const stockQuantity of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER, NaN, '0']) {
            expect(parseReceiptAck({ ...ack, state, stockQuantity }, operation)).toBeNull();
        }
    });
});
