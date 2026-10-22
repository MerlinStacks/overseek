import { describe, expect, it } from 'vitest';
import { orderIdParamSchema } from './schemas';
describe('shared database-safe order IDs', () => {
    it.each(['0', '-1', '1.5', '2147483648', '99999999999999999999999', 'true', ''])('rejects invalid Woo ID %s', id => expect(orderIdParamSchema.safeParse({ id }).success).toBe(false));
    it.each(['1', '2147483647', '11111111-1111-4111-8111-111111111111'])('accepts supported identity %s', id => expect(orderIdParamSchema.safeParse({ id }).success).toBe(true));
});
