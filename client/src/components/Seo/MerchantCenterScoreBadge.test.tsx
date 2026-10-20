import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MerchantCenterScoreBadge } from './MerchantCenterScoreBadge';
afterEach(() => { cleanup(); });
describe('Merchant Center score badge', () => {
    it('qualifies empty local checks instead of guaranteeing compliance or sync readiness', () => {
        render(<MerchantCenterScoreBadge score={100} issues={[]} />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByRole('region')).toHaveTextContent('No issues reported by the local checks.');
        expect(screen.getByRole('region')).toHaveTextContent('do not guarantee');
        expect(screen.queryByText('Compliant')).toBeNull();
        expect(screen.queryByText('Ready for sync')).toBeNull();
        expect(screen.queryByText('Meets all requirements')).toBeNull();
    });
    it('distinguishes missing analysis from completed empty checks', () => {
        render(<MerchantCenterScoreBadge score={0} />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByRole('region')).toHaveTextContent('No usable Merchant Center analysis available.');
    });
    it('shows critical issues and warnings through an accessible details region', () => {
        render(<MerchantCenterScoreBadge score={50} issues={[{ severity: 'error', attribute: 'title', message: 'Title required' }, { severity: 'warning', message: 'Barcode absent' }]} />);
        const button = screen.getByRole('button'); fireEvent.click(button);
        const details = screen.getByRole('region');
        expect(button).toHaveAttribute('aria-controls', details.id);
        expect(details).toHaveTextContent('Critical (1)'); expect(details).toHaveTextContent('Warnings (1)');
        expect(details).toHaveTextContent('Title required'); expect(details).toHaveTextContent('Barcode absent');
    });
    it('does not call malformed analysis an empty successful check', () => {
        render(<MerchantCenterScoreBadge score={100} issues={[null, 'broken'] as any} />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByRole('region')).toHaveTextContent('No usable Merchant Center analysis available.');
    });
    it.each([[150, 'MC: 100/100'], [-5, 'MC: 0/100'], [NaN, 'MC: N/A']])('normalizes score %s', (score, expected) => {
        render(<MerchantCenterScoreBadge score={score} />);
        expect(screen.getByRole('button')).toHaveTextContent(expected);
    });
});
