import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import { LandingPage } from './LandingPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';

afterEach(cleanup);

it('keeps the public landing actions tenant-aware without requiring account context', () => {
    const { container } = render(<MemoryRouter><LandingPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Get OverSeek on GitHub' })).toHaveClass('bg-[var(--primary-color)]', 'text-[var(--primary-foreground)]', 'hover:bg-[var(--primary-hover)]', 'focus-visible:outline-[var(--focus-color)]');
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy-policy');
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(6);
    expect(container.querySelector('[class*="gradient"], [class*="backdrop-blur"], [class*="blur-3xl"]')).toBeNull();
});

it.each([
    { Page: ForgotPasswordPage, action: 'Send reset link', field: 'Email' },
    { Page: ResetPasswordPage, action: 'Reset password', field: 'New password' },
])('uses brand actions and visible input focus for $action', ({ Page, action, field }) => {
    render(<MemoryRouter initialEntries={[`/reset-password?token=${'a'.repeat(64)}`]}><Page /></MemoryRouter>);
    expect(screen.getByRole('button', { name: action })).toHaveClass('bg-[var(--primary-color)]', 'text-[var(--primary-foreground)]', 'hover:bg-[var(--primary-hover)]', 'focus-visible:outline-[var(--focus-color)]');
    expect(screen.getByLabelText(field)).toHaveClass('focus:ring-[var(--brand-border)]', 'focus:border-[var(--primary-color)]');
    expect(screen.getByRole('link', { name: 'Back to login' })).toHaveAttribute('href', '/login');
});
