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

    it('evaluates click and collect shipping type conditions', () => {
        const result = automationConditionService.evaluate({
            matchType: 'all',
            conditions: [
                { field: 'order.shippingType', operator: 'eq', value: 'click_and_collect' }
            ]
        }, {
            order: {
                shipping_lines: [{ method_id: 'local_pickup', method_title: 'Click and Collect' }]
            }
        });

        expect(result).toBe(true);
    });

    it('evaluates delivery shipping type conditions', () => {
        const result = automationConditionService.evaluate({
            matchType: 'all',
            conditions: [
                { field: 'order.shippingType', operator: 'eq', value: 'delivery' }
            ]
        }, {
            order: {
                shipping_lines: [{ method_id: 'flat_rate', method_title: 'Standard shipping' }]
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

    it('evaluates inbox email activity condition', () => {
        const result = automationConditionService.evaluate({
            matchType: 'all',
            conditions: [
                { field: 'inbox.customerSentEmail', operator: 'eq', value: 'true' }
            ]
        }, {
            customer: {
                hasInboxEmail: true
            }
        });

        expect(result).toBe(true);
    });

    it('evaluates review recency condition using lookback days', () => {
        const recentResult = automationConditionService.evaluate({
            matchType: 'all',
            conditions: [
                { field: 'customer.reviewedInLastDays', operator: 'eq', value: 30 }
            ]
        }, {
            customer: {
                latestReviewDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
            }
        });

        const staleResult = automationConditionService.evaluate({
            matchType: 'all',
            conditions: [
                { field: 'customer.reviewedInLastDays', operator: 'eq', value: 30 }
            ]
        }, {
            customer: {
                latestReviewDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
            }
        });

        expect(recentResult).toBe(true);
        expect(staleResult).toBe(false);
    });

    it('evaluates latest review rating condition', () => {
        const fiveStarResult = automationConditionService.evaluate({
            matchType: 'all',
            conditions: [
                { field: 'customer.latestReviewRating', operator: 'eq', value: 5 }
            ]
        }, {
            customer: {
                latestReviewRating: 5
            }
        });

        const fourStarResult = automationConditionService.evaluate({
            matchType: 'all',
            conditions: [
                { field: 'customer.latestReviewRating', operator: 'eq', value: 5 }
            ]
        }, {
            customer: {
                latestReviewRating: 4
            }
        });

        expect(fiveStarResult).toBe(true);
        expect(fourStarResult).toBe(false);
    });

    it('matches order status conditions after normalizing Woo status prefixes', () => {
        expect(automationConditionService.evaluate(
            { field: 'order.status', operator: 'eq', value: 'processing' },
            { order: { status: 'wc-processing' } }
        )).toBe(true);
    });

    it('returns false for non-matching order status conditions', () => {
        expect(automationConditionService.evaluate(
            { field: 'order.status', operator: 'eq', value: 'completed' },
            { order: { status: 'processing' } }
        )).toBe(false);
    });

    it('does not treat missing fields as a passing neq condition', () => {
        expect(automationConditionService.evaluate(
            { field: 'order.status', operator: 'neq', value: 'completed' },
            { order: {} }
        )).toBe(false);
    });

    it('does not pass unsupported operators by default', () => {
        expect(automationConditionService.evaluate(
            { field: 'order.status', operator: 'unknown_operator', value: 'completed' },
            { order: { status: 'completed' } }
        )).toBe(false);
    });

    it('does not pass empty condition config by default', () => {
        expect(automationConditionService.evaluate({}, { order: { status: 'completed' } })).toBe(false);
    });

    it('evaluates day-of-week conditions using the UI value format', () => {
        const today = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];

        expect(automationConditionService.evaluate(
            { field: 'date.dayOfWeek', operator: 'eq', value: today },
            {}
        )).toBe(true);
    });
});
