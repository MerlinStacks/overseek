import { describe, expect, it } from 'vitest';
import { resolveMergeTags } from '../MergeTagResolver';

describe('MergeTagResolver cart merge tags', () => {
    it('renders cart recovery merge tags', () => {
        const html = resolveMergeTags(
            'Resume here: {{cart.recoveryUrl}} total {{cart.total}} {{cart.currency}}',
            {
                cart: {
                    recoveryUrl: 'https://api.example.com/api/marketing/recover-cart/token',
                    total: 149.95,
                    currency: 'AUD',
                    items: []
                }
            }
        );

        expect(html).toContain('https://api.example.com/api/marketing/recover-cart/token');
        expect(html).toContain('$149.95');
        expect(html).toContain('AUD');
    });

    it('renders coupon merge tags', () => {
        const html = resolveMergeTags(
            'Use {{coupon.code}} for {{coupon.discount}} before {{coupon.expiry}}',
            {
                coupon: {
                    code: 'WINBACK-1234',
                    amount: 15,
                    discountType: 'percent',
                    expiresAt: '2026-05-01T00:00:00.000Z'
                }
            }
        );

        expect(html).toContain('WINBACK-1234');
        expect(html).toContain('15%');
        expect(html).toContain('1 May 2026');
    });
});
