import { describe, expect, it } from 'vitest';
import { compileEmailDesignV2, createDefaultEmailDesignV2 } from './emailDesignerV2';

describe('emailDesignerV2', () => {
    it('renders email-client-safe social logo images', () => {
        const design = createDefaultEmailDesignV2({ title: 'Social test' });
        design.document.sections = [{
            id: 'section-social',
            backgroundColor: '#ffffff',
            columns: [{
                id: 'column-social',
                width: 100,
                blocks: [{
                    id: 'social-1',
                    type: 'social',
                    props: {
                        links: [{ label: 'Facebook', href: 'https://facebook.com/example' }],
                        iconStyle: 'solid',
                        iconSet: 'native',
                    },
                }],
            }],
        }];

        const html = compileEmailDesignV2(design);

        expect(html).toContain('src="https://img.icons8.com/ios-filled/50/ffffff/facebook-new.png"');
        expect(html).toContain('alt="Facebook"');
        expect(html).not.toContain('<svg');
    });

    it('includes dark mode support for the compiled email shell', () => {
        const html = compileEmailDesignV2(createDefaultEmailDesignV2({ title: 'Dark test' }));

        expect(html).toContain('<meta name="color-scheme" content="light dark">');
        expect(html).toContain('@media (prefers-color-scheme: dark)');
        expect(html).toContain('class="os-email-bg"');
        expect(html).toContain('class="os-email-card"');
        expect(html).toContain('class="os-email-section"');
        expect(html).toContain('os-email-text');
        expect(html).toContain('os-email-footer');
    });

    it('shows GST total in order summary blocks', () => {
        const design = createDefaultEmailDesignV2({ title: 'Order summary test' });
        design.document.sections = [{
            id: 'section-order-summary',
            backgroundColor: '#ffffff',
            columns: [{
                id: 'column-order-summary',
                width: 100,
                blocks: [{
                    id: 'order-summary-1',
                    type: 'orderSummary',
                    props: { heading: 'Order summary', showTotals: true, itemsFormat: 'table' },
                }],
            }],
        }];

        const html = compileEmailDesignV2(design);

        expect(html).toContain('{{order.itemsTable}}');
        expect(html).toContain('GST: {{order.taxTotal}}');
        expect(html).toContain('Total: {{order.total}}');
    });

    it('renders abandoned cart items and recovery links', () => {
        const design = createDefaultEmailDesignV2({ title: 'Cart test' });
        design.document.sections = [{
            id: 'section-cart',
            backgroundColor: '#ffffff',
            columns: [{
                id: 'column-cart',
                width: 100,
                blocks: [{
                    id: 'cart-items-1',
                    type: 'cartItems',
                    props: { heading: 'Still in your cart', showTotal: true },
                }, {
                    id: 'cart-link-1',
                    type: 'cartLink',
                    props: { label: 'Complete checkout', href: '{{cart.recoveryUrl}}', body: 'Pick up where you left off.' },
                }],
            }],
        }];

        const html = compileEmailDesignV2(design);

        expect(html).toContain('{{cart.itemsTable}}');
        expect(html).toContain('Cart total: {{cart.total}}');
        expect(html).toContain('href="{{cart.recoveryUrl}}"');
        expect(html).toContain('Complete checkout');
    });

    it('wires order tracking blocks to AusPost order tracking merge tags', () => {
        const design = createDefaultEmailDesignV2({ title: 'Tracking test' });
        design.document.sections = [{
            id: 'section-order-tracking',
            backgroundColor: '#ffffff',
            columns: [{
                id: 'column-order-tracking',
                width: 100,
                blocks: [{
                    id: 'order-tracking-1',
                    type: 'orderTracking',
                    props: {
                        heading: 'Track your order',
                        body: 'Track this delivery through Australia Post.',
                        buttonLabel: 'Track with AusPost',
                        showTrackingNumber: true,
                    },
                }],
            }],
        }];

        const html = compileEmailDesignV2(design);

        expect(html).toContain('href="{{order.auspostTrackingUrl}}"');
        expect(html).toContain('{{order.trackingNumber}}');
        expect(html).toContain('Track with AusPost');
    });

    it('renders new products blocks as dynamic merge tags', () => {
        const design = createDefaultEmailDesignV2({ title: 'New products test' });
        design.document.sections = [{
            id: 'section-new-products',
            backgroundColor: '#ffffff',
            columns: [{
                id: 'column-new-products',
                width: 100,
                blocks: [{
                    id: 'new-products-1',
                    type: 'newProducts',
                    props: {
                        heading: 'Fresh arrivals',
                        count: 4,
                        columns: 2,
                        showImage: true,
                        showDescription: true,
                        showPrice: true,
                        showButton: true,
                        buttonLabel: 'Shop now',
                    },
                }],
            }],
        }];

        const html = compileEmailDesignV2(design);

        expect(html).toContain('Fresh arrivals');
        expect(html).toContain('{{new_products count:4 columns:2 showImage:true showDescription:true showPrice:true showButton:true buttonLabel:Shop%20now textColor:%230f172a mutedTextColor:%2364748b primaryColor:%234f46e5 borderRadius:14}}');
    });

    it('clamps new product counts to whole supported values', () => {
        const design = createDefaultEmailDesignV2();
        design.document.sections[0].columns[0].blocks = [{
            id: 'new-products-clamped',
            type: 'newProducts',
            props: {
                heading: '', count: 0, columns: 2, showImage: true,
                showDescription: false, showPrice: true, showButton: true, buttonLabel: 'View',
            },
        }];

        expect(compileEmailDesignV2(design)).toContain('{{new_products count:1 columns:2');
    });
});
