import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReportsOverviewTab } from './ReportsOverviewTab';
import { ReportResults } from '../../reports/ReportResults';

afterEach(cleanup);

describe('compact report summaries', () => {
    it('groups all overview values and helpers in one semantic strip without shrinking charts', () => {
        const { container } = render(<ReportsOverviewTab isLoading={false} currency="USD" salesData={[{ date: '2026-10-20', sales: 120, orders: 3 }]} customerGrowth={[{ newCustomers: 2 }]} topProducts={[{ name: 'Ring', quantity: 4 }]} />);
        const summary = screen.getByLabelText('Report summary');
        expect(summary.tagName).toBe('DL');
        expect(summary).toHaveClass('metric-strip');
        expect(within(summary).getAllByRole('term')).toHaveLength(4);
        expect(within(summary).getByText('$120')).toBeInTheDocument();
        expect(within(summary).getByText('$40.00')).toBeInTheDocument();
        expect(within(summary).getByText('Revenue ÷ completed orders')).toBeInTheDocument();
        expect(within(summary).getByText('First seen this period')).toBeInTheDocument();
        expect(container.querySelector('dl dl')).toBeNull();
        expect(container.querySelector('.h-72')).toBeInTheDocument();
        expect(screen.getByText('Ring')).toBeInTheDocument();
    });

    it('keeps loading placeholders compact and replaces them with labelled metrics', () => {
        const props = { salesData: [], topProducts: [], customerGrowth: [] };
        const { rerender } = render(<ReportsOverviewTab {...props} isLoading />);
        expect(within(screen.getByLabelText('Loading report summary')).getAllByRole('term')).toHaveLength(4);
        expect(screen.queryByText('No revenue data yet')).not.toBeInTheDocument();
        rerender(<ReportsOverviewTab {...props} isLoading={false} />);
        expect(within(screen.getByLabelText('Report summary')).getByText('Orders')).toBeInTheDocument();
        expect(screen.getByText('No revenue data yet')).toBeInTheDocument();
        expect(screen.getByText('No products sold yet')).toBeInTheDocument();
    });

    it('retains report totals, every table metric and export actions beside the compact summary', () => {
        render(<ReportResults results={[{ dimension: '2026-10-20', sales: 120, orders: 3, quantity: 4, sessions: 10, visitors: 8 }]} metrics={['sales', 'orders', 'quantity', 'sessions', 'visitors']} dimension="day" viewMode error={null} hasSearched />);
        const summary = screen.getByLabelText('Custom report summary');
        expect(summary).toHaveClass('metric-strip');
        expect(within(summary).getAllByRole('term')).toHaveLength(4);
        expect(within(summary).getByText('$120.00')).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: 'Visitors' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CSV' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'PDF' })).toBeEnabled();
    });
});
