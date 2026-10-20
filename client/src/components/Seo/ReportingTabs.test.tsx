import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ digest: {} as Record<string, unknown>, revenue: {} as Record<string, unknown>, cann: {} as Record<string, unknown>, retry: vi.fn() }));
vi.mock('../../hooks/useSeoKeywords', () => ({ useSeoDigest: () => mocks.digest, useKeywordRevenue: () => mocks.revenue, useCannibalization: () => mocks.cann, useContentBrief: () => ({}) }));
import { DigestTab } from './DigestTab';
import { RevenueTab } from './RevenueTab';
import { HealthTab } from './HealthTab';
beforeEach(() => { vi.clearAllMocks(); mocks.digest = { refetch: mocks.retry }; mocks.revenue = { refetch: mocks.retry }; mocks.cann = { refetch: mocks.retry }; });
afterEach(cleanup);
describe('SEO report state accuracy', () => {
    it('distinguishes digest failures from an unavailable digest', () => {
        mocks.digest.error = new Error('Failed'); render(<DigestTab />);
        expect(screen.getByRole('alert')).toHaveTextContent('Could not load'); expect(screen.queryByText('No digest available yet.')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Retry digest' })); expect(mocks.retry).toHaveBeenCalledOnce();
    });
    it('does not assert healthy cannibalization results after an analysis failure', () => {
        mocks.cann.error = new Error('Failed'); render(<HealthTab />);
        expect(screen.getByRole('alert')).toHaveTextContent('Could not complete cannibalization'); expect(screen.queryByText('No cannibalization detected!')).toBeNull();
    });
    it('handles the actual stored revenue shape without missing-field crashes or fabricated zero metrics', () => {
        mocks.revenue.data = { keywords: [{ keyword: 'Query', estimatedRevenue: 20, sessions: null, conversions: null }] };
        render(<RevenueTab />);
        expect(screen.getByRole('heading', { name: 'Estimated Keyword Revenue' })).toBeInTheDocument();
        expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(2); expect(screen.getAllByText('20.00')).toHaveLength(2);
        expect(screen.getByText(/Currency and reporting period are not recorded/)).toBeInTheDocument();
        expect(screen.queryByText('Total Organic Revenue')).toBeNull();
    });
    it('provides a revenue retry rather than displaying an empty-data message for errors', () => {
        mocks.revenue.error = new Error('Failed'); render(<RevenueTab />);
        fireEvent.click(screen.getByRole('button', { name: 'Retry revenue' })); expect(mocks.retry).toHaveBeenCalledOnce();
        expect(screen.queryByText('No keyword revenue estimates available.')).toBeNull();
    });
    it('announces digest loading', () => { mocks.digest.isLoading = true; render(<DigestTab />); expect(screen.getByRole('status', { name: 'Loading SEO digest' })).toBeInTheDocument(); });
});
