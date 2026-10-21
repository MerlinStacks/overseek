import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MerchantCenterPanel } from './MerchantCenterPanel';
import { SeoAnalysisPanel } from './SeoAnalysisPanel';
afterEach(cleanup);
describe('truthful analysis availability', () => {
    it('does not claim Merchant compliance when no analysis was recorded', () => { render(<MerchantCenterPanel score={0} issues={null} />); expect(screen.getByRole('status')).toHaveTextContent('compliance has not been established'); expect(screen.queryByText('Ready for sync')).toBeNull(); });
    it('keeps a measured zero but does not imply Google approval', () => { render(<MerchantCenterPanel score={0} issues={[]} />); expect(screen.getByText('Assessment score: 0/100')).toBeInTheDocument(); expect(screen.getByText(/Google approval.*not guaranteed/)).toBeInTheDocument(); });
    it.each([NaN, Infinity, -1, 101])('does not render an invalid SEO score %s', score => { render(<SeoAnalysisPanel score={score} tests={[{ test: 'Title', passed: false, message: 'Add title' }]} />); expect(screen.getByRole('status')).toHaveTextContent('unavailable'); expect(screen.queryByRole('progressbar')).toBeNull(); });
    it('treats missing checks as unavailable but preserves measured zero with recorded checks', () => {
        const view = render(<SeoAnalysisPanel score={0} tests={[]} />); expect(screen.getByRole('status')).toBeInTheDocument(); view.rerender(<SeoAnalysisPanel score={0} tests={[{ test: 'Title', passed: false, message: 'Add title' }]} />); expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0'); expect(screen.getByText('Add title')).toBeInTheDocument();
    });
});
