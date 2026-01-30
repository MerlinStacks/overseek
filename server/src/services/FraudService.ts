/**
 * Fraud Detection Service
 * 
 * Calculates fraud risk score for orders based on heuristics.
 */

import { Logger } from '../utils/logger';

interface FraudResult {
    score: number;
    level: 'low' | 'medium' | 'high';
    factors: string[];
}

const FREE_EMAIL_DOMAINS = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'aol.com', 'icloud.com', 'protonmail.com', 'mail.com'
];

export class FraudService {
    /**
     * Calculate fraud risk score for an order.
     * Score ranges: 0-20 Low, 21-40 Medium, 41+ High
     */
    static calculateScore(orderData: any): FraudResult {
        let score = 0;
        const factors: string[] = [];

        const billing = orderData.billing || {};
        const shipping = orderData.shipping || {};

        // Factor 1: Shipping ≠ Billing Address (+25)
        if (this.addressesDiffer(billing, shipping)) {
            score += 25;
            factors.push('Shipping address differs from billing address');
        }

        // Factor 2: Different names on billing/shipping (+20)
        if (this.namesDiffer(billing, shipping)) {
            score += 20;
            factors.push('Different names on billing and shipping');
        }

        // Factor 3: High-value order >$500 (+15)
        const total = parseFloat(orderData.total || '0');
        if (total > 500) {
            score += 15;
            factors.push(`High-value order ($${total.toFixed(2)})`);
        }

        // Factor 4: New customer / first order (+10)
        const customerMeta = orderData._customerMeta;
        if (!customerMeta || customerMeta.ordersCount <= 1) {
            score += 10;
            factors.push('First order from this customer');
        }

        // Factor 5: International shipping (+10)
        if (billing.country && shipping.country && billing.country !== shipping.country) {
            score += 10;
            factors.push('International shipping (different country)');
        }

        // Factor 6: Free email domain (+5)
        const email = billing.email || orderData.billing_email || '';
        const domain = email.split('@')[1]?.toLowerCase();
        if (domain && FREE_EMAIL_DOMAINS.includes(domain)) {
            score += 5;
            factors.push('Free email provider');
        }

        // Determine risk level
        let level: 'low' | 'medium' | 'high' = 'low';
        if (score > 40) level = 'high';
        else if (score > 20) level = 'medium';

        Logger.debug('[FraudService] Score calculated', { score, level, factors });

        return { score, level, factors };
    }

    private static addressesDiffer(billing: any, shipping: any): boolean {
        if (!shipping.address_1 && !shipping.city) return false; // No shipping address provided

        const billingAddr = `${billing.address_1 || ''} ${billing.city || ''} ${billing.postcode || ''}`.toLowerCase().trim();
        const shippingAddr = `${shipping.address_1 || ''} ${shipping.city || ''} ${shipping.postcode || ''}`.toLowerCase().trim();

        return billingAddr !== shippingAddr && shippingAddr.length > 0;
    }

    private static namesDiffer(billing: any, shipping: any): boolean {
        if (!shipping.first_name && !shipping.last_name) return false; // No shipping name provided

        const billingName = `${billing.first_name || ''} ${billing.last_name || ''}`.toLowerCase().trim();
        const shippingName = `${shipping.first_name || ''} ${shipping.last_name || ''}`.toLowerCase().trim();

        return billingName !== shippingName && shippingName.length > 0;
    }
}
