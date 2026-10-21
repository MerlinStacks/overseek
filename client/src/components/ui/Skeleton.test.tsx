import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CardSkeleton, Skeleton, SkeletonText, TableSkeleton } from './Skeleton';
afterEach(cleanup);
describe('decorative loading placeholders', () => {
    it('hides placeholders and honors reduced-motion preferences', () => {
        const { container } = render(<><Skeleton /><CardSkeleton /></>);
        expect(container.querySelectorAll('.motion-reduce\\:animate-none').length).toBeGreaterThan(1);
        expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true'); expect(container.lastElementChild).toHaveAttribute('aria-hidden', 'true');
    });
    it('bounds invalid placeholder counts and preserves valid table markup', () => {
        const { container } = render(<><SkeletonText lines={Infinity} /><table><tbody><TableSkeleton rows={2} columns={3} /></tbody></table></>);
        expect(container.querySelectorAll('tr')).toHaveLength(2); expect(container.querySelectorAll('td')).toHaveLength(6);
        expect(container.querySelector('tr')).toHaveAttribute('aria-hidden', 'true');
    });
});
