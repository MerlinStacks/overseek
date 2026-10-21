import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const config = vi.hoisted(() => ({ appName: 'Store', privacyEmail: 'privacy@localhost', privacyPolicyUpdatedAt: '', legalEmail: 'legal@localhost', termsUpdatedAt: '' }));
vi.mock('../config/site', () => ({ siteConfig: config }));
import { PrivacyPolicyPage } from './PrivacyPolicyPage';
import { DataDeletionPage } from './DataDeletionPage';
import { TermsOfServicePage } from './TermsOfServicePage';
beforeEach(() => { config.privacyEmail = 'privacy@localhost'; config.privacyPolicyUpdatedAt = ''; config.legalEmail = 'legal@localhost'; config.termsUpdatedAt = ''; });
afterEach(cleanup);
describe('truthful legal pages', () => {
    it('does not manufacture a revision date or link to localhost', () => {
        render(<MemoryRouter><PrivacyPolicyPage /></MemoryRouter>); expect(screen.queryByText(/Last updated/)).toBeNull(); expect(screen.queryByRole('link', { name: /localhost/ })).toBeNull(); expect(screen.getByText(/Privacy contact is not configured/)).toBeInTheDocument(); expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(5);
    });
    it('shows an operator-supplied valid revision date and privacy contact', () => {
        config.privacyPolicyUpdatedAt = '2026-09-20'; config.privacyEmail = 'privacy@store.example'; render(<MemoryRouter><PrivacyPolicyPage /></MemoryRouter>); expect(screen.getByText('2026-09-20')).toHaveAttribute('dateTime', '2026-09-20'); expect(screen.getByRole('link', { name: 'privacy@store.example' })).toHaveAttribute('href', 'mailto:privacy@store.example');
    });
    it('omits invalid dates and separates access revocation from deletion', () => {
        config.privacyPolicyUpdatedAt = '2026-02-30'; render(<MemoryRouter><PrivacyPolicyPage /><DataDeletionPage /></MemoryRouter>); expect(screen.queryByText(/Last updated/)).toBeNull(); expect(screen.getByRole('heading', { name: 'Revoke Facebook access (not a deletion request)' })).toBeInTheDocument(); expect(screen.getByText(/does not itself delete/)).toBeInTheDocument();
    });
    it('does not manufacture a terms revision date or advertise an unusable legal contact', () => {
        render(<MemoryRouter><TermsOfServicePage /></MemoryRouter>); expect(screen.queryByText(/Last updated:/)).toBeNull(); expect(screen.queryByRole('link', { name: /localhost/ })).toBeNull(); expect(screen.getByText(/Legal contact is not configured/)).toBeInTheDocument(); expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(12);
    });
    it('uses only the operator-supplied terms revision and legal email', () => {
        config.termsUpdatedAt = '2026-10-01'; config.legalEmail = 'legal@store.example'; render(<MemoryRouter><TermsOfServicePage /></MemoryRouter>); expect(screen.getByText('2026-10-01')).toHaveAttribute('dateTime', '2026-10-01'); expect(screen.getByRole('link', { name: 'legal@store.example' })).toHaveAttribute('href', 'mailto:legal@store.example');
    });
});
