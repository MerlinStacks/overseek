import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardSkeleton, InboxSkeleton, ListSkeleton, OrdersSkeleton, Skeleton } from './MobileSkeleton';
afterEach(cleanup);
describe('mobile loading skeletons', () => {
    it('keeps visual primitives decorative and respects reduced motion', () => {
        const { container } = render(<Skeleton />);
        expect(container.firstChild).toHaveAttribute('aria-hidden', 'true'); expect(container.firstChild).toHaveClass('motion-reduce:animate-none');
    });
    it.each([[DashboardSkeleton, 'Loading dashboard'], [InboxSkeleton, 'Loading inbox'], [OrdersSkeleton, 'Loading orders']] as const)('provides one named loading status for each preset', (Component, name) => {
        render(<Component />); expect(screen.getByRole('status', { name })).toBeInTheDocument();
    });
    it.each([-1, NaN, Infinity, 1.5])('safely handles a malformed list count %s', count => {
        render(<ListSkeleton count={count} />); expect(screen.getByRole('status', { name: 'Loading list' })).toBeInTheDocument();
    });
});
