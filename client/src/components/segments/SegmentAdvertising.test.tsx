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
});
