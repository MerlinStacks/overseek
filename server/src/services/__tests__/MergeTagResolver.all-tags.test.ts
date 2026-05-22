import { describe, expect, it } from 'vitest';
import { resolveMergeTags } from '../MergeTagResolver';

describe('MergeTagResolver all merge tags', () => {
    const catalogMergeTags = [
        '{{customer.firstName}}',
        '{{customer.lastName}}',
        '{{customer.email}}',
        '{{customer.phone}}',
        '{{order.number}}',
        '{{order.date}}',
        '{{order.status}}',
        '{{order.paymentMethod}}',
        '{{order.subtotal}}',
        '{{order.shippingTotal}}',
        '{{order.discountTotal}}',
        '{{order.total}}',
        '{{order.customerNote}}',
        '{{order.trackingNumber}}',
        '{{order.trackingUrl}}',
        '{{order.auspostTrackingUrl}}',
        '{{order.billingAddress}}',
        '{{order.shippingAddress}}',
        '{{order.itemsTable}}',
        '{{order.downloads}}',
        '{{order.invoiceUrl}}',
        '{{product.name}}',
        '{{product.price}}',
        '{{product.image}}',
        '{{product.description}}',
        '{{coupon.code}}',
        '{{coupon.discount}}',
        '{{coupon.description}}',
        '{{coupon.expiry}}',
        '{{review.reviewer}}',
        '{{review.rating}}',
        '{{review.content}}',
        '{{review.productName}}',
        '{{review.productUrl}}',
        '{{cart.recoveryUrl}}',
        '{{cart.checkoutUrl}}',
        '{{cart.total}}',
        '{{cart.currency}}',
        '{{cart.itemsTable}}',
        '{{store_url}}',
        '{{unsubscribe_url}}',
        '{{preferences_url}}',
    ];

    const context = {
        storeUrl: 'store.example.com',
        linkTriggerUrl: 'https://store.example.com/special',
        preferencesUrl: 'https://store.example.com/my-account/edit-account',
        unsubscribeUrl: 'https://store.example.com/?unsubscribe=token-123',
        order: {
            id: 99,
            orderNumber: 'WC-99',
            dateCreated: '2026-06-01T00:00:00.000Z',
            status: 'processing',
            paymentMethodTitle: 'Credit Card',
            subtotal: 100,
            shippingTotal: 12,
            discountTotal: 10,
            total: 102,
            currency: 'AUD',
            customerNote: 'Leave at reception',
            tracking_items: [
                {
                    provider: 'Australia Post',
                    trackingNumber: '33A1234567890',
                    trackingUrl: 'https://auspost.com.au/mypost/track/#/details/33A1234567890',
                    dateShipped: null,
                },
            ],
            billingAddress: {
                firstName: 'Alex',
                lastName: 'Doe',
                address1: '1 Main St',
                city: 'Sydney',
                state: 'NSW',
                postcode: '2000',
                country: 'AU',
            },
            shippingAddress: {
                firstName: 'Alex',
                lastName: 'Doe',
                address1: '1 Main St',
                city: 'Sydney',
                state: 'NSW',
                postcode: '2000',
                country: 'AU',
            },
            lineItems: [
                { name: 'Classic Hoodie', quantity: 1, total: 89, currency: 'AUD' },
            ],
            downloads: [
                { name: 'Manual', download_url: 'https://store.example.com/download/manual' },
            ],
            invoiceUrl: 'https://store.example.com/invoices/99.pdf',
        },
        customer: {
            firstName: 'Alex',
            lastName: 'Doe',
            email: 'alex@example.com',
            phone: '+61000000000',
        },
        product: {
            name: 'Classic Hoodie',
            price: 89,
            images: [{ src: 'https://store.example.com/images/hoodie.jpg' }],
            shortDescription: 'Soft cotton hoodie',
        },
        coupon: {
            code: 'WELCOME10',
            amount: 10,
            discountType: 'percent',
            description: 'Ten percent off',
            expiresAt: '2026-06-30T00:00:00.000Z',
        },
        cart: {
            recoveryUrl: 'https://store.example.com/recover/abc',
            checkoutUrl: 'https://store.example.com/checkout',
            total: 149.95,
            currency: 'AUD',
            items: [{ name: 'Classic Hoodie', quantity: 1, total: 149.95, currency: 'AUD' }],
        },
        review: {
            reviewer: 'Alex Doe',
            rating: 5,
            content: 'Great product and quick delivery.',
            productName: 'Classic Hoodie',
            productUrl: 'https://store.example.com/products/classic-hoodie',
        },
    };

    it('resolves all supported tags including URL tags', () => {
        const template = [
            '{{store_url}}',
            '{{link_trigger}}',
            '{{preferences_url}}',
            '{{unsubscribe_url}}',
            '{{customer.firstName}}',
            '{{customer.lastName}}',
            '{{customer.email}}',
            '{{customer.phone}}',
            '{{order.number}}',
            '{{order.date}}',
            '{{order.status}}',
            '{{order.paymentMethod}}',
            '{{order.subtotal}}',
            '{{order.shippingTotal}}',
            '{{order.discountTotal}}',
            '{{order.total}}',
            '{{order.customerNote}}',
            '{{order.trackingNumber}}',
            '{{order.trackingUrl}}',
            '{{order.auspostTrackingUrl}}',
            '{{tracking_number}}',
            '{{tracking_url}}',
            '{{order.billingAddress}}',
            '{{order.shippingAddress}}',
            '{{order.itemsTable}}',
            '{{order.downloads}}',
            '{{order.invoiceUrl}}',
            '{{invoice_url}}',
            '{{pdf_url}}',
            '{{product.name}}',
            '{{product.price}}',
            '{{product.image}}',
            '{{product.description}}',
            '{{coupon.code}}',
            '{{coupon.discount}}',
            '{{coupon.description}}',
            '{{coupon.expiry}}',
            '{{cart.recoveryUrl}}',
            '{{cart.checkoutUrl}}',
            '{{cart.total}}',
            '{{cart.currency}}',
            '{{cart.itemsTable}}',
            '{{review.reviewer}}',
            '{{review.rating}}',
            '{{review.content}}',
            '{{review.productName}}',
            '{{review.productUrl}}',
        ].join(' | ');

        const html = resolveMergeTags(template, context);

        expect(html).toContain('https://store.example.com');
        expect(html).toContain('https://store.example.com/special');
        expect(html).toContain('https://store.example.com/my-account/edit-account');
        expect(html).toContain('https://store.example.com/?unsubscribe=token-123');
        expect(html).toContain('https://store.example.com/products/classic-hoodie');
        expect(html).toContain('https://store.example.com/invoices/99.pdf');
        expect(html).toContain('https://store.example.com/recover/abc');
        expect(html).toContain('https://store.example.com/checkout');
        expect(html).toContain('Alex');
        expect(html).toContain('Classic Hoodie');
        expect(html).toContain('WELCOME10');
        expect(html).toContain('33A1234567890');
        expect(html).toContain('https://auspost.com.au/mypost/track/#/details/33A1234567890');

        expect(html).not.toMatch(/\{\{[^}]+\}\}/);
    });

    it('resolves encoded catalog tags in href values', () => {
        const template = catalogMergeTags
            .map((tag) => `<a href="https://overseek.com.au/${encodeURIComponent(tag)}">${tag}</a>`)
            .join('');

        const html = resolveMergeTags(template, context);

        expect(html).not.toMatch(/%7B%7B/i);
        expect(html).not.toMatch(/%7D%7D/i);
        expect(html).not.toMatch(/\{\{[^}]+\}\}/);
        expect(html).toContain('href="https://store.example.com/invoices/99.pdf"');
        expect(html).toContain('href="https://store.example.com/products/classic-hoodie"');
        expect(html).toContain('href="https://store.example.com/recover/abc"');
        expect(html).toContain('href="https://store.example.com/checkout"');
    });

    it('builds AusPost tracking URLs from Woo shipment tracking metadata', () => {
        const html = resolveMergeTags(
            '{{order.trackingNumber}} | {{order.trackingUrl}} | {{order.auspostTrackingUrl}}',
            {
                order: {
                    id: 100,
                    meta_data: [
                        {
                            key: '_wc_shipment_tracking_items',
                            value: [
                                {
                                    tracking_provider: 'Australia Post',
                                    tracking_number: 'ABC 123',
                                },
                            ],
                        },
                    ],
                },
            }
        );

        expect(html).toContain('ABC 123');
        expect(html).toContain('https://auspost.com.au/mypost/track/#/details/ABC%20123');
    });
});
