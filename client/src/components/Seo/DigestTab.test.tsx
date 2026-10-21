import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ data: { period: { start: '2026-10-01', end: '2026-10-07' }, summary: { totalClicks: 10, totalImpressions: 20, clicksChange: 2, impressionsChange: -3, avgPosition: null, positionChange: null }, topMovers: { improved: [], declined: [] }, newKeywords: [], alerts: [], coverage: { possiblyTruncated: true } } }));
vi.mock('../../hooks/useSeoKeywords', () => ({ useSeoDigest: () => ({ data: m.data, isLoading: false, error: null, refetch: vi.fn() }) }));
import { DigestTab } from './DigestTab';
describe('sample-aware digest presentation', () => {
    it('labels absolute count changes and unavailable rank without inventing zero position', () => {
        render(<DigestTab />); expect(screen.getByText('+2 vs previous sample')).toBeInTheDocument(); expect(screen.getByText('-3 vs previous sample')).toBeInTheDocument(); expect(screen.getAllByText('Unavailable')).toHaveLength(2); expect(screen.getByText(/not whole-site totals/)).toBeInTheDocument(); expect(screen.queryByText(/2\.0%/)).toBeNull();
    });
});
