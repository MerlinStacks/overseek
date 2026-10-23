import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Metric, MetricStrip } from './MetricStrip';
import { MetricStripSkeleton } from './Skeleton';

afterEach(cleanup);

describe('compact summaries', () => {
    it('groups labelled values without individual card surfaces or losing supporting context', () => {
        const { container } = render(<MetricStrip label="Order summary"><Metric label="Today’s orders" value={34} hint="6 more than yesterday" /><Metric label="In production" value={18} hint="Across 12 products" /><Metric label="Ready to dispatch" value={7} hint="Next collection 3:00 pm" /></MetricStrip>);
        expect(container.querySelector('dl')).toHaveAttribute('aria-label', 'Order summary');
        expect(container.querySelectorAll('dt')).toHaveLength(3);
        expect(container.querySelectorAll('dd')).toHaveLength(3);
        expect(screen.getByText('Next collection 3:00 pm')).toBeVisible();
        for (const item of container.querySelectorAll('.metric-strip-item')) {
            for (const cardClass of ['rounded-xl', 'shadow-sm', 'p-6', 'bg-white']) {
                expect(item).not.toHaveClass(cardClass);
            }
        }
    });

    it('preserves zero, unavailable values and caller-provided semantic styling', () => {
        render(<MetricStrip><Metric label="Failed" value={0} valueClassName="text-red-700 dark:text-red-300" /><Metric label="Revenue" value="Unavailable" hint="Currency not confirmed" /></MetricStrip>);
        expect(screen.getByText('0')).toHaveClass('text-red-700', 'dark:text-red-300');
        expect(screen.getByText('Unavailable')).toBeVisible();
        expect(screen.getByText('Currency not confirmed')).toBeVisible();
    });

    it('uses the same compact grouping for loading without exposing fake metrics', () => {
        const { container } = render(<MetricStripSkeleton metrics={3} />);
        expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
        expect(container.querySelectorAll('.metric-strip-item')).toHaveLength(3);
        expect(container.querySelectorAll('dt, dd')).toHaveLength(0);
    });
});
