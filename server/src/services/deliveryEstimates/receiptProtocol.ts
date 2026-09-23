import { z } from 'zod';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const receiptOperationSchema = z.object({
    operationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), sequence: id,
    productWooId: id, variationWooId: id.nullable(), stockOwnerWooId: id,
    delta: z.number().int().min(-1_000_000).max(1_000_000).refine(n => n !== 0),
}).strict().refine(op => [op.productWooId, op.variationWooId].includes(op.stockOwnerWooId) && op.variationWooId !== op.productWooId);
export type ReceiptWireOperation = z.infer<typeof receiptOperationSchema>;
const ackSchema = z.object({
    schemaVersion: z.literal(1), operationId: z.string(), sequence: id, stockOwnerWooId: id,
    state: z.enum(['prepared', 'applied', 'uncertain']), stockQuantity: z.number().finite().nullable(),
    guardActive: z.literal(true), receiptSafety: z.literal('unverified'),
}).strict().refine(ack => ack.state === 'applied'
    ? Number.isSafeInteger(ack.stockQuantity)
    : ack.stockQuantity === null);
export function parseReceiptAck(value: unknown, operation: ReceiptWireOperation) {
    const result = ackSchema.safeParse(value);
    if (!result.success || result.data.operationId !== operation.operationId || result.data.sequence !== operation.sequence || result.data.stockOwnerWooId !== operation.stockOwnerWooId) return null;
    return result.data;
}
