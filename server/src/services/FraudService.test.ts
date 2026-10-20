import { describe, expect, it, vi } from 'vitest';
vi.mock('../utils/logger', () => ({ Logger: { debug: vi.fn() } }));
import { FraudService } from './FraudService';
describe('fraud heuristic input handling', () => {
    it('distinguishes unavailable history from a confirmed first order', () => {
        const unknown = FraudService.calculateScore({ total: '0' }); expect(unknown.score).toBe(0); expect(unknown.warnings).toContain('Customer order history unavailable');
        expect(FraudService.calculateScore({ total: '0', _customerMeta: { ordersCount: 1 } }).score).toBe(10);
    });
    it('normalizes whitespace and casing without inferring differences from missing fields', () => {
        const result = FraudService.calculateScore({ total: '0', billing: { address_1: ' 10   Main St ', city: 'Sydney', first_name: ' ALEX ', country: 'au', email: 42 }, shipping: { address_1: '10 main st', first_name: 'alex', country: 'AU' }, _customerMeta: { ordersCount: 2 } });
        expect(result.score).toBe(0);
    });
    it('does not invent a dollar currency label or score invalid numbers', () => {
        const invalid = FraudService.calculateScore({ total: '900junk', _fpScore: Infinity }); expect(invalid.score).toBe(0);
        expect(FraudService.calculateScore({ total: 600, currency: 'AUD' }).factors).toContain('High-value order (AUD 600.00)');
    });
    it('rejects an absent order rather than crashing on a property read', () => { expect(() => FraudService.calculateScore(null)).toThrow('Order data'); });
});
