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
    warnings: string[];
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
        const warnings: string[] = [];
        if (!orderData || typeof orderData !== 'object' || Array.isArray(orderData)) throw new Error('Order data required');
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
        const total = typeof orderData.total === 'number' ? orderData.total : typeof orderData.total === 'string' && /^\d+(?:\.\d+)?$/.test(orderData.total.trim()) ? Number(orderData.total) : NaN;
        if (Number.isFinite(total) && total > 500) {
            score += 15;
            const currency = typeof orderData.currency === 'string' && /^[A-Z]{3}$/i.test(orderData.currency) ? orderData.currency.toUpperCase() : 'currency unavailable';
            factors.push(`High-value order (${currency} ${total.toFixed(2)})`);
            warnings.push('The high-value threshold is 500 in the order currency; currencies are not converted.');
        }
        if (!Number.isFinite(total) || total < 0) warnings.push('Order value unavailable or invalid');

        // Factor 4: New customer / first order (+10)
        const customerMeta = orderData._customerMeta;
        if (Number.isSafeInteger(customerMeta?.ordersCount) && customerMeta.ordersCount >= 0 && customerMeta.ordersCount <= 1) {
            score += 10;
            factors.push('First order from this customer');
        }
        if (!Number.isSafeInteger(customerMeta?.ordersCount) || customerMeta.ordersCount < 0) warnings.push('Customer order history unavailable');

        // Factor 5: International shipping (+10)
        if (this.text(billing.country) && this.text(shipping.country) && this.text(billing.country) !== this.text(shipping.country)) {
            score += 10;
            factors.push('International shipping (different country)');
        }

        // Factor 6: Free email domain (+5)
        const email = this.text(billing.email) || this.text(orderData.billing_email);
        const domain = email.split('@').length === 2 ? email.split('@')[1] : '';
        if (domain && FREE_EMAIL_DOMAINS.includes(domain)) {
            score += 5;
            factors.push('Free email provider');
        }

        // Factor 7: Browser fingerprint bot score from checkout
        const fpScore = orderData._fpScore;
        if (typeof fpScore === 'number' && Number.isFinite(fpScore) && fpScore >= 0 && fpScore <= 100) {
            if (fpScore >= 60) {
                score += 30;
                factors.push(`High bot fingerprint score (${fpScore})`);
            } else if (fpScore >= 40) {
                score += 15;
                factors.push(`Suspicious bot fingerprint score (${fpScore})`);
            }
        }

        // Determine risk level
        let level: 'low' | 'medium' | 'high' = 'low';
        if (score > 40) level = 'high';
        else if (score > 20) level = 'medium';

        Logger.debug('[FraudService] Score calculated', { score, level, factors });

        return { score, level, factors, warnings };
    }

    private static text(value: unknown): string {
        return typeof value === 'string' ? value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ') : '';
    }

    private static addressesDiffer(billing: any, shipping: any): boolean {
        if (!shipping.address_1 && !shipping.city) return false; // No shipping address provided

        return ['address_1', 'city', 'postcode'].some(key => {
            const first = this.text(billing[key]); const second = this.text(shipping[key]);
            return first && second && first !== second;
        });
    }

    private static namesDiffer(billing: any, shipping: any): boolean {
        if (!shipping.first_name && !shipping.last_name) return false; // No shipping name provided

        return ['first_name', 'last_name'].some(key => {
            const first = this.text(billing[key]); const second = this.text(shipping[key]);
            return first && second && first !== second;
        });
    }
}
