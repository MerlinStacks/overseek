import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RetiredWholesaleCatalogPage } from './RetiredWholesaleCatalogPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('explains legacy links without fetching catalog data or needing account context', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<RetiredWholesaleCatalogPage />);
    expect(screen.getByRole('heading', { name: 'Wholesale catalogs are no longer available' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to OverSeek' })).toHaveAttribute('href', '/');
    expect(fetch).not.toHaveBeenCalled();
});
