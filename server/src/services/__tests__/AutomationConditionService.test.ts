import { describe, expect, it } from 'vitest';
import { automationConditionService } from '../AutomationConditionService';

describe('AutomationConditionService', () => {
    it('evaluates grouped Woo conditions with match-all logic', () => {
        const result = automationConditionService.evaluate({
            matchType: 'all',
            conditions: [
                { field: 'order.total', operator: 'gte', value: 100 },
                { field: 'customer.country', operator: 'eq', value: 'AU' },
                { field: 'order.productId', operator: 'contains', value: '42' }
            ]
        }, {
            order: {
                total: 149.95,
                billing: { country: 'AU' },
                line_items: [{ product_id: 42, quantity: 1 }]
            }
        });

        expect(result).toBe(true);
    });

    it('evaluates any-match conditions', () => {
        const result = automationConditionService.evaluate({
            matchType: 'any',
            conditions: [
                { field: 'customer.ordersCount', operator: 'gte', value: 10 },
                { field: 'customer.email', operator: 'contains', value: '@example.com' }
            ]
        }, {
            customer: {
                ordersCount: 1,
                email: 'buyer@example.com'
            }
        });

        expect(result).toBe(true);
    });

    it('evaluates lifecycle and coupon-based conditions', () => {
        const result = automationConditionService.evaluate({
            matchType: 'all',
            conditions: [
                { field: 'customer.daysSinceLastOrder', operator: 'gte', value: 45 },
                { field: 'customer.emailDomain', operator: 'eq', value: 'example.com' },
                { field: 'order.couponCode', operator: 'contains', value: 'WINBACK15' }
            ]
        }, {
            customer: {
                daysSinceLastOrder: 90,
                emailDomain: 'example.com'
            },
            order: {
                coupon_lines: [{ code: 'WINBACK15' }]
            }
        });

        expect(result).toBe(true);
    });

    it('supports between comparisons for hour-based conditions', () => {
        const result = automationConditionService.evaluate({
            matchType: 'all',
            conditions: [
                { field: 'date.hour', operator: 'between', value: '0,23' }
            ]
        }, {});

        expect(result).toBe(true);
    });
});
