import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoiceRenderer } from './InvoiceRenderer';

describe('InvoiceRenderer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-26T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders invoice metadata, payment block, and legal footer from settings', () => {
        const layout = [
            { i: 'order', x: 0, y: 0, w: 6, h: 2 },
            { i: 'payment', x: 6, y: 0, w: 6, h: 2 },
            { i: 'footer', x: 0, y: 2, w: 12, h: 2 },
        ];
        const items = [
            { id: 'order', type: 'order_details' },
            { id: 'payment', type: 'payment_block' },
            { id: 'footer', type: 'footer', content: 'Thanks for your order' },
        ];
        const data = {
            number: '1001',
            date_created: '2026-04-20T00:00:00.000Z',
            payment_method_title: 'Card',
            shipping_lines: [{ method_title: 'Express' }],
            line_items: [],
            total: '10.00',
            total_tax: '1.00',
            shipping_total: '0.00',
            currency: 'AUD'
        };
        const settings = {
            numbering: { prefix: 'INV-', nextNumber: 1234, padding: 5 },
            compliance: { legalFooter: 'ABN 12 345 678 901', paymentTermsDays: 7 },
            payment: { payNowUrl: 'https://pay.example.com/invoice/INV-01234', payNowLabel: 'Pay now' }
        };

        const { container } = render(
            <InvoiceRenderer
                layout={layout}
                items={items}
                data={data}
                settings={settings}
                readOnly={true}
            />
        );

        expect(screen.getByText(/Invoice Number:/i)).toBeInTheDocument();
        expect(screen.getAllByText(/INV-01234/i).length).toBeGreaterThan(0);
        expect(screen.getByText(/Pay now:/i)).toBeInTheDocument();
        expect(screen.getByText(/ABN 12 345 678 901/i)).toBeInTheDocument();
        expect(container).toMatchSnapshot();
    });
});
