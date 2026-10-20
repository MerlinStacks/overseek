import { describe, expect, it } from 'vitest';
import { createAccountSchema, dateRangeSchema, paginationSchema, updateProductSchema } from './validation';
describe('shared request schemas', () => {
    it('coerces pagination strings but rejects booleans and empty values', () => {
        expect(paginationSchema.parse({ query: { page: '2', limit: '10' } }).query).toEqual({ page: 2, limit: 10 });
        for (const page of [true, null, '', -1, 'bad']) expect(paginationSchema.safeParse({ query: { page } }).success).toBe(false);
    });
    it('validates date ordering and rejects empty and null dates', () => {
        expect(dateRangeSchema.safeParse({ query: { startDate: '2026-10-20', endDate: '2026-10-19' } }).success).toBe(false);
        for (const startDate of ['', null, false, 'invalid']) expect(dateRangeSchema.safeParse({ query: { startDate } }).success).toBe(false);
        expect(dateRangeSchema.safeParse({ query: { startDate: '2026-10-19', endDate: '2026-10-20' } }).success).toBe(true);
    });
    it.each(['ftp://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'invalid'])('rejects a non-website Woo URL %s without throwing', wooUrl => {
        expect(createAccountSchema.safeParse({ body: { name: 'Store', wooUrl, wooConsumerKey: 'key-123456789', wooConsumerSecret: 'secret-123456789' } }).success).toBe(false);
    });
    it('accepts zero pricing and COGS but not negative or null values', () => {
        expect(updateProductSchema.parse({ params: { id: '1' }, body: { price: '0', cogs: 0 } }).body).toEqual({ price: 0, cogs: 0 });
        for (const price of [null, false, '', -1]) expect(updateProductSchema.safeParse({ params: { id: 1 }, body: { price } }).success).toBe(false);
    });
});
