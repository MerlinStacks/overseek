import { createRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Card, CardTitle } from './Card';
afterEach(cleanup);
describe('card primitives', () => {
    it('forwards a heading ref to CardTitle', () => {
        const ref = createRef<HTMLHeadingElement>();
        render(<CardTitle ref={ref}>Title</CardTitle>);
        expect(ref.current).toBe(screen.getByRole('heading', { level: 3 }));
        expect(ref.current?.tagName).toBe('H3');
    });
    it('retains custom props and reduced-motion overrides', () => {
        render(<Card data-testid="card" glass accent className="custom">Content</Card>);
        expect(screen.getByTestId('card')).toHaveClass('custom', 'motion-reduce:transition-none', 'motion-reduce:transform-none');
    });
});
