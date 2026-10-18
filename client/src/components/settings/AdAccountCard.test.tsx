import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdAccountCard, type AdInsightError } from './AdAccountCard';

describe('Ad account reconnection', () => {
    function setup(options: { platform?: string; pending?: boolean; error?: AdInsightError; loading?: boolean } = {}) {
        const actions = { onRefresh: vi.fn(), onReconnect: vi.fn(), onEdit: vi.fn(), onDisconnect: vi.fn(), onCompleteSetup: vi.fn() };
        render(<AdAccountCard account={{ id: 'existing-account', name: 'Shop Ads', platform: options.platform || 'GOOGLE', externalId: options.pending ? 'PENDING_SETUP' : '1234567890' }}
            insights={{ spend: 123, currency: 'AUD', roas: 2.5, impressions: 1000, clicks: 50 }}
            isLoadingInsights={options.loading || false} error={options.error} {...actions} />);
        return actions;
    }

    it.each(['GOOGLE', 'META'])('always offers reconnect for a healthy %s account', platform => {
        const actions = setup({ platform });
        expect(screen.getByText('Active')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: `Reconnect ${platform === 'GOOGLE' ? 'Google Ads' : 'Meta'} account` }));
        expect(actions.onReconnect).toHaveBeenCalledOnce();
        expect(actions.onDisconnect).not.toHaveBeenCalled();
        expect(actions.onRefresh).not.toHaveBeenCalled();
    });

    it('keeps statistics refresh separate from reauthorisation', () => {
        const actions = setup();
        fireEvent.click(screen.getByTitle('Refresh data'));
        expect(actions.onRefresh).toHaveBeenCalledOnce();
        expect(actions.onReconnect).not.toHaveBeenCalled();
    });

    it('keeps reconnect enabled even while statistics are loading', () => {
        setup({ loading: true });
        expect(screen.getByRole('button', { name: 'Reconnect Google Ads account' })).toBeEnabled();
        expect(screen.getByTitle('Refresh data')).toBeDisabled();
    });

    it('has one reconnect action for authentication errors, not two competing buttons', () => {
        setup({ error: { message: 'Token expired' } });
        expect(screen.getAllByRole('button', { name: /Reconnect/ })).toHaveLength(1);
        expect(screen.getByText('Token expired')).toBeInTheDocument();
    });

    it('preserves retrying statistics for temporary failures without forcing reauthorisation', () => {
        const actions = setup({ error: { message: 'Temporarily unavailable', code: 'AD_INSIGHTS_UNAVAILABLE', isRecoverable: true } });
        expect(screen.getByRole('button', { name: 'Reconnect Google Ads account' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(actions.onRefresh).toHaveBeenCalledOnce();
        expect(actions.onReconnect).not.toHaveBeenCalled();
    });

    it('keeps pending-account setup instead of reconnecting an incomplete connection', () => {
        const actions = setup({ pending: true });
        expect(screen.queryByRole('button', { name: /Reconnect/ })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Complete Setup' }));
        expect(actions.onCompleteSetup).toHaveBeenCalledOnce();
    });
});
