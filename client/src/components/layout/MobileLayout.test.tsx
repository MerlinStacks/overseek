import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileLayout } from './MobileLayout';

const state = vi.hoisted(() => ({
    account: { name: 'Store', appearance: { appName: 'CustomKings', logoUrl: '/logo.png', primaryColor: '#daae32' } },
    throttle: () => false,
}));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: state.account }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../../hooks/useHaptic', () => ({ useHaptic: () => ({ triggerHaptic: vi.fn() }) }));
vi.mock('../../hooks/useVisibilityPolling', () => ({ useVisibilityPolling: vi.fn() }));
vi.mock('../../hooks/useVisibilityRefreshThrottle', () => ({ useVisibilityRefreshThrottle: () => state.throttle }));
vi.mock('../mobile/PWAUpdateModal', () => ({
    usePWAUpdate: () => ({ updateAvailable: false, showModal: false }),
    PWAUpdateModal: () => null,
    PWAUpdateBanner: () => null,
}));

afterEach(cleanup);

describe('companion shell identity', () => {
    it('renders Appearance branding, recovers from a broken logo, and resets on account switch', () => {
        const { container, rerender } = render(<MemoryRouter><MobileLayout><p>Workspace</p></MobileLayout></MemoryRouter>);
        expect(screen.getByRole('button', { name: 'Store settings for CustomKings' })).toBeInTheDocument();
        expect(container.querySelector('.mobile-companion')).toHaveStyle('--mobile-brand: #daae32');
        expect(container.querySelector('.mobile-companion')).toHaveClass('dark');
        fireEvent.error(container.querySelector('img')!);
        expect(container.querySelector('header img')).not.toBeInTheDocument();
        expect(screen.getByText('C')).toBeInTheDocument();

        state.account = { name: 'Another store', appearance: { appName: '', logoUrl: '', primaryColor: '' } };
        rerender(<MemoryRouter><MobileLayout><p>Workspace</p></MobileLayout></MemoryRouter>);
        expect(screen.getByRole('button', { name: 'Store settings for Another store' })).toBeInTheDocument();
        expect(container.querySelector('.mobile-companion')).toHaveStyle('--mobile-brand: #2563eb');
        expect(screen.queryByText('CustomKings')).not.toBeInTheDocument();
    });
});
