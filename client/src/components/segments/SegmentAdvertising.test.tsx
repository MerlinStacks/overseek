import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentAdvertising } from './SegmentAdvertising';
const mocks = vi.hoisted(() => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'tenant' } }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => mocks.toast }));

describe('Advertising data-sharing options', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('requires fresh consent after expanding sharing and submits explicit options', async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'ads', name: 'Ads', platform: 'GOOGLE' }] });
        vi.stubGlobal('fetch', fetch);
        render(<SegmentAdvertising segment={{ id: 'segment', name: 'Clickers' }} onRefresh={vi.fn().mockResolvedValue(undefined)} />);
        await screen.findByRole('option', { name: 'GOOGLE · Ads' });
        fireEvent.change(screen.getByLabelText('Advertising destination'), { target: { value: 'ads' } });
        const [subscribers, matching, consent] = screen.getAllByRole('checkbox');
        expect(subscribers).not.toBeChecked();
        expect(matching).not.toBeChecked();
        fireEvent.click(consent);
        expect(screen.getByRole('button', { name: 'Enable / update sync' })).toBeEnabled();
        fireEvent.click(subscribers);
        expect(consent).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Enable / update sync' })).toBeDisabled();
        fireEvent.click(matching);
        fireEvent.click(consent);
        fireEvent.click(screen.getByRole('button', { name: 'Enable / update sync' }));
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ adAccountId: 'ads', consentConfirmed: true, includeSubscribers: true, enhancedMatching: true });
    });
    it('can retry a failed enabled sync directly without changing its matching options', async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
        vi.stubGlobal('fetch', fetch);
        const onRefresh = vi.fn().mockResolvedValue(undefined);
        render(<SegmentAdvertising segment={{ id: 'segment', name: 'Never Spent', audienceSyncs: [{
            id: 'sync', platform: 'GOOGLE', audienceName: 'Never Spent', status: 'FAILED', lastSyncAt: null,
            lastError: 'Google rejected audience sync (HTTP 403)', memberCount: 0, autoSyncEnabled: true, includeSubscribers: true, enhancedMatching: true
        }] }} onRefresh={onRefresh} />);
        await screen.findByRole('button', { name: 'Retry sync' });
        fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
        await waitFor(() => expect(onRefresh).toHaveBeenCalled());
        expect(fetch).toHaveBeenCalledWith('/api/segments/segment/audiences/sync', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: true }) }));
        expect(screen.getByRole('button', { name: 'Pause sync' })).toBeInTheDocument();
    });
});
