import { describe, expect, it } from 'vitest';
import { resolveMergeTags } from '../MergeTagResolver';

describe('MergeTagResolver cart merge tags', () => {
    it('renders link trigger merge tag with provided URL', () => {
        const html = resolveMergeTags(
            '<a href="{{link_trigger}}">Trigger</a>',
            {
                linkTriggerUrl: 'https://example.com/trigger-path'
            }
        );

        expect(html).toContain('https://example.com/trigger-path');
    });

    it('falls back link trigger merge tag to store URL', () => {
        const html = resolveMergeTags(
            '<a href="{{link_trigger}}">Trigger</a>',
            {
                storeUrl: 'https://store.example.com'
            }
        );

        expect(html).toContain('https://store.example.com');
    });

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

    it('renders invoice download merge tags', () => {
        const html = resolveMergeTags(
            '<a href="{{order.invoiceUrl}}">Invoice</a> {{invoice_url}} {{pdf_url}}',
            {
                order: {
                    invoice_url: 'https://example.com/wp-json/overseek/v1/invoices/download?order_id=1234'
                }
            }
        );

        expect(html).toContain('https://example.com/wp-json/overseek/v1/invoices/download?order_id=1234');
        expect(html).not.toContain('{{order.invoiceUrl}}');
        expect(html).not.toContain('{{invoice_url}}');
        expect(html).not.toContain('{{pdf_url}}');
    });

    it('renders encoded invoice merge tags in href values', () => {
        const html = resolveMergeTags(
            '<a href="https://overseek.com.au/%7B%7Border.invoiceUrl%7D%7D">Invoice</a>',
            {
                order: {
                    invoice_url: 'https://example.com/invoices/1234.pdf'
                }
            }
        );

        expect(html).toContain('href="https://example.com/invoices/1234.pdf"');
        expect(html).not.toContain('%7B%7Border.invoiceUrl%7D%7D');
    });

    it('renders review merge tags', () => {
        const html = resolveMergeTags(
            'Review by {{review.reviewer}} rated {{review.rating}} on {{review.productName}}: {{review.content}} - {{review.productUrl}}',
            {
                review: {
                    reviewer: 'Taylor',
                    rating: 5,
                    productName: 'Classic Hoodie',
                    content: 'Great fit and quality.',
                    productUrl: 'https://store.example.com/products/classic-hoodie'
                }
            }
        );

        expect(html).toContain('Taylor');
        expect(html).toContain('5');
        expect(html).toContain('Classic Hoodie');
        expect(html).toContain('Great fit and quality.');
        expect(html).toContain('https://store.example.com/products/classic-hoodie#review_form');
    });

    it('renders review merge tags from fallback field names', () => {
        const html = resolveMergeTags(
            '{{review.reviewer}} | {{review.content}} | {{review.productName}} | {{review.productUrl}}',
            {
                review: {
                    reviewerName: 'Jordan',
                    review: 'Arrived quickly.',
                    product_name: 'Canvas Tote',
                    product_url: 'https://store.example.com/products/canvas-tote'
                }
            }
        );

        expect(html).toContain('Jordan');
        expect(html).toContain('Arrived quickly.');
        expect(html).toContain('Canvas Tote');
        expect(html).toContain('https://store.example.com/products/canvas-tote#review_form');
    });

    it('renders review merge tags with defaults when review context is missing', () => {
        const html = resolveMergeTags(
            '{{review.reviewer}} | {{review.rating}} | {{review.content}} | {{review.productName}} | {{review.productUrl}}',
            {
                customer: {
                    firstName: 'Sam',
                    lastName: 'Lee',
                },
                product: {
                    name: 'Everyday Tee',
                    permalink: 'https://store.example.com/products/everyday-tee',
                },
                storeUrl: 'https://store.example.com',
            }
        );

        expect(html).toContain('Sam Lee');
        expect(html).toContain('5');
        expect(html).toContain('Thanks for your order. We would love to hear your feedback.');
        expect(html).toContain('Everyday Tee');
        expect(html).toContain('https://store.example.com/products/everyday-tee#review_form');
    });

    it('builds a WooCommerce product review link from order line items', () => {
        const html = resolveMergeTags(
            '<a href="{{review.productUrl}}">Review {{review.productName}}</a>',
            {
                order: {
                    line_items: [{ product_id: 123, name: 'Custom Mug' }]
                },
                storeUrl: 'https://store.example.com',
            }
        );

        expect(html).toContain('Review Custom Mug');
        expect(html).toContain('href="https://store.example.com/?p=123#review_form"');
    });

    it('uses the product review fallback when review context only has the store homepage', () => {
        const html = resolveMergeTags(
            '<a href="{{review.productUrl}}">Review {{review.productName}}</a>',
            {
                review: {
                    reviewer: 'Taylor',
                    productUrl: 'https://store.example.com/'
                },
                order: {
                    line_items: [{ product_id: 456, name: 'Custom Cap' }]
                },
                storeUrl: 'https://store.example.com',
            }
        );

        expect(html).toContain('Review Custom Cap');
        expect(html).toContain('href="https://store.example.com/?p=456#review_form"');
    });

    it('prefers explicit CusRev review URLs from order metadata', () => {
        const html = resolveMergeTags(
            '<a href="{{review.productUrl}}">Review your order</a><a href="{{review.url}}">CusRev</a>',
            {
                order: {
                    line_items: [{ product_id: 789, name: 'Custom Shirt' }],
                    meta_data: [{
                        key: '_cusrev_review_reminder_url',
                        value: 'https://store.example.com/review-order/?ivole_order=99&ivole_token=abc123'
                    }]
                },
                storeUrl: 'https://store.example.com',
            }
        );

        expect(html).toContain('href="https://store.example.com/review-order/?ivole_order=99&ivole_token=abc123"');
        expect(html).not.toContain('#review_form');
    });
});
