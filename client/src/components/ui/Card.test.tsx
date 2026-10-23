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
    it('retains custom props while legacy glass and hover options stay opaque and static', () => {
        render(<Card data-testid="card" glass accent className="custom">Content</Card>);
        const card = screen.getByTestId('card');
        expect(card).toHaveClass('custom', 'bg-white', 'dark:bg-slate-800', 'border-t-[var(--brand-border)]');
        expect(card.className).not.toMatch(/backdrop|gradient|translate|hover:shadow/);
        expect(card).not.toHaveAttribute('glass');
        expect(card).not.toHaveAttribute('noHover');
    });
});
