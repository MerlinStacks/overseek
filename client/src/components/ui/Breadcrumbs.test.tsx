import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Breadcrumbs } from './Breadcrumbs';
afterEach(cleanup);
describe('breadcrumb semantics', () => {
    it('names its landmark and marks the final item as the current page', () => {
        render(<MemoryRouter><Breadcrumbs items={[{ label: 'Products', href: '/inventory' }, { label: 'Product' }]} /></MemoryRouter>);
        expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument(); expect(screen.getByRole('list')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('href', '/inventory'); expect(screen.getByText('Product')).toHaveAttribute('aria-current', 'page');
    });
    it('renders nothing for an empty path', () => { const { container } = render(<Breadcrumbs items={[]} />); expect(container).toBeEmptyDOMElement(); });
});
