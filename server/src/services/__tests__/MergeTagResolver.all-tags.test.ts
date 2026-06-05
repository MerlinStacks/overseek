import { describe, expect, it } from 'vitest';
import { applyPreviewText, resolveMergeTags } from '../MergeTagResolver';

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
        '{{order.taxTotal}}',
        '{{order.total}}',
        '{{order.customerNote}}',
        '{{order.trackingNumber}}',
        '{{order.trackingUrl}}',
        '{{order.auspostTrackingUrl}}',
        '{{order.billingAddress}}',
        '{{order.shippingAddress}}',
        '{{order.itemsTable}}',
        '{{order.itemsCompact}}',
        '{{order.itemsList}}',
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
            taxTotal: 9.27,
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
                { name: 'Classic Hoodie', quantity: 1, total: 89, total_tax: 8.09, currency: 'AUD' },
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
            '{{order.taxTotal}}',
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
            '{{order.itemsCompact}}',
            '{{order.itemsList}}',
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
        expect(html).toContain('GST: $8.09');
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
        expect(html).toContain('href="https://store.example.com/products/classic-hoodie#review_form"');
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

    it('resolves order blocks from raw WooCommerce order payloads', () => {
        const html = resolveMergeTags(
            '{{order.number}} {{order.date}} {{order.paymentMethod}} {{order.billingAddress}} {{order.shippingAddress}} {{order.itemsTable}} Total: {{order.total}}',
            {
                order: {
                    id: 123,
                    number: '100123',
                    date_created: '2026-06-02T10:15:00',
                    payment_method_title: 'Direct bank transfer',
                    currency: 'AUD',
                    total: '42.50',
                    total_tax: '3.86',
                    billing: {
                        first_name: 'Jordan',
                        last_name: 'Smith',
                        address_1: '22 Test Lane',
                        city: 'Melbourne',
                        state: 'VIC',
                        postcode: '3000',
                        country: 'AU',
                    },
                    shipping: {
                        first_name: 'Jordan',
                        last_name: 'Smith',
                        address_1: '44 Ship Road',
                        city: 'Brisbane',
                        state: 'QLD',
                        postcode: '4000',
                        country: 'AU',
                    },
                    line_items: [
                        { name: 'Printed Tee', quantity: 2, total: '42.50', total_tax: '3.86' },
                    ],
                },
            }
        );

        expect(html).toContain('100123');
        expect(html).toContain('2 June 2026');
        expect(html).toContain('Direct bank transfer');
        expect(html).toContain('22 Test Lane');
        expect(html).toContain('44 Ship Road');
        expect(html).toContain('Printed Tee');
        expect(html).toContain('GST: $3.86');
        expect(html).toContain('$42.50');
        expect(html).not.toMatch(/\{\{[^}]+\}\}/);
    });

    it('renders compact and list order item formats', () => {
        const html = resolveMergeTags(
            '{{order.itemsCompact}} {{order.itemsList}}',
            {
                order: {
                    line_items: [
                        { name: 'Printed Tee', quantity: 2, total: '42.50', total_tax: '3.86', currency: 'AUD' },
                    ],
                },
            }
        );

        expect(html).toContain('Qty: 2');
        expect(html).toContain('$42.50');
        expect(html).toContain('GST: $3.86');
        expect(html).toContain('<li>2 x Printed Tee</li>');
        expect(html).not.toMatch(/\{\{[^}]+\}\}/);
    });

    it('renders WooCommerce item image objects in order item tables', () => {
        const html = resolveMergeTags(
            '{{order.itemsTable}}',
            {
                order: {
                    line_items: [
                        {
                            name: 'Photo Mug',
                            quantity: 1,
                            total: '19.95',
                            image: { src: 'https://store.example.com/uploads/photo-mug.jpg' },
                        },
                    ],
                },
            }
        );

        expect(html).toContain('src="https://store.example.com/uploads/photo-mug.jpg"');
        expect(html).toContain('alt="Photo Mug"');
    });

    it('builds invoice download URLs from store URL, order id, and order key', () => {
        const html = resolveMergeTags(
            '<a href="{{order.invoiceUrl}}">Download Invoice</a>',
            {
                storeUrl: 'https://store.example.com',
                order: {
                    id: 1234,
                    order_key: 'wc_order_abc123',
                },
            }
        );

        expect(html).toContain('https://store.example.com/wp-json/overseek/v1/invoices/download?order_id=1234&order_key=wc_order_abc123');
        expect(html).not.toContain('{{order.invoiceUrl}}');
    });

    it('replaces the designer preheader with escaped preview text', () => {
        const html = '<body><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Old preview</div><p>Hello</p></body>';

        const result = applyPreviewText(html, 'New <preview> & copy');

        expect(result).toContain('New &lt;preview&gt; &amp; copy');
        expect(result).toContain('<p>Hello</p>');
        expect(result).not.toContain('Old preview');
    });

    it('uses fallback syntax only when a merge tag has no resolved value', () => {
        const html = resolveMergeTags(
            'Hi {{customer.firstName | fallback: "there"}}, your order is {{order.number | fallback: "ready"}}.',
            { customer: { first_name: 'Alex' } }
        );

        expect(html).toBe('Hi Alex, your order is ready.');
    });
});
