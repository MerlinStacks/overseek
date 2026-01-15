import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobileErrorBoundary } from './MobileErrorBoundary';
import * as Sentry from '@sentry/react';
import React from 'react';

// Mock Sentry
vi.mock('@sentry/react', () => ({
    captureException: vi.fn(),
}));

const ThrowError = () => {
    throw new Error('Test Error');
};

describe('MobileErrorBoundary', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders children when no error occurs', () => {
        render(
            <MobileErrorBoundary>
                <div>Safe Content</div>
            </MobileErrorBoundary>
        );
        expect(screen.getByText('Safe Content')).toBeInTheDocument();
    });

    it('renders fallback and calls Sentry when error occurs', () => {
        // Suppress console.error for this test as the boundary logs it
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        render(
            <MobileErrorBoundary>
                <ThrowError />
            </MobileErrorBoundary>
        );

        // Check fallback UI
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();

        // Check Sentry call
        expect(Sentry.captureException).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                extra: expect.any(Object)
            })
        );

        // Cleanup spy
        consoleSpy.mockRestore();
    });
});
