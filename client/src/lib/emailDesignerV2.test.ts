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
});
