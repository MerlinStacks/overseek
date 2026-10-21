import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../ui/Modal', () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));
import { ProductSeoModal } from './ProductSeoModal';
afterEach(cleanup);
describe('product assessment availability', () => {
    it('does not present missing assessments as zero or compliant', () => {
        render(<ProductSeoModal isOpen product={{ name: 'Product' }} onClose={vi.fn()} />);
        expect(screen.getAllByRole('status')).toHaveLength(2); expect(screen.queryByText('0/100')).toBeNull(); expect(screen.queryByText('Compliant')).toBeNull();
    });
    it('preserves actual zero scores and validated issues', () => {
        render(<ProductSeoModal isOpen product={{ seoScore: 0, seoData: { analysis: [{ test: 'Title', passed: false, message: 'Title missing' }] }, merchantCenterScore: 0, merchantCenterIssues: [{ severity: 'error', message: 'Price missing' }] }} onClose={vi.fn()} />);
        expect(screen.getAllByText('0/100')).toHaveLength(2); expect(screen.getByText('Title missing')).toBeInTheDocument(); expect(screen.getByText('Price missing')).toBeInTheDocument();
    });
    it('does not filter malformed findings into a false clean assessment', () => {
        render(<ProductSeoModal isOpen product={{ seoScore: Infinity, seoData: { analysis: [] }, merchantCenterScore: 100, merchantCenterIssues: [{ severity: 'error', message: {} }] }} onClose={vi.fn()} />);
        expect(screen.getAllByRole('status')).toHaveLength(2); expect(screen.queryByText(/No issues recorded/)).toBeNull();
    });
});
