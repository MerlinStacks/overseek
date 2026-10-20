import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../components/marketing/AdPerformanceView', () => ({ AdPerformanceView: () => <p>Ad performance</p> }));
import { PaidAdsPage } from './PaidAdsPage';
afterEach(cleanup);
describe('paid ads page', () => {
    it('preserves its content and has readable dark-mode heading styles', () => {
        render(<PaidAdsPage />);
        expect(screen.getByRole('heading', { name: 'Paid Ads' })).toHaveClass('dark:text-slate-100');
        expect(screen.getByText('Ad performance')).toBeInTheDocument();
    });
});
