import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({ useApi: () => ({ ...api, accountId: 'store-a', isReady: true }) }));
import { CAPISettings } from './CAPISettings';

beforeEach(() => {
    vi.resetAllMocks();
    api.get.mockResolvedValue({ platforms: {
        google: { enabled: true, config: { customerId: '1234567890', conversionActionId: '123' }, updatedAt: null },
        meta: { enabled: true, config: { pixelId: 'meta-pixel', accessToken: '********' }, updatedAt: null },
    } });
});
afterEach(cleanup);

describe('Google tracking safeguards', () => {
    it('shows browser dependency and ROAS goal caveats and only checks Google configuration', async () => {
        api.post.mockResolvedValue({ success: true, message: 'Warning: This action is Secondary.' });
        render(<CAPISettings />);
        fireEvent.click(await screen.findByRole('button', { name: /Google Ads/ }));
        expect(screen.getByText(/server enhancements cannot replace a missed browser purchase/)).toBeInTheDocument();
        expect(screen.getByText(/ROAS uses Google Ads Conversions value/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Check Google Configuration' }));
        await screen.findByText('Warning: This action is Secondary.');
        expect(api.post).toHaveBeenCalledExactlyOnceWith('/api/capi/test/google', { accountId: 'store-a' });
        expect(api.put).not.toHaveBeenCalled();
    });

    it('saving Google settings does not submit or overwrite the Meta configuration', async () => {
        api.put.mockResolvedValue({ success: true, config: { customerId: '1234567890', conversionActionId: '123' } });
        render(<CAPISettings />);
        fireEvent.click(await screen.findByRole('button', { name: /Google Ads/ }));
        fireEvent.click(within(document.getElementById('capi-google')!).getByRole('button', { name: 'Save' }));
        expect(api.put).toHaveBeenCalledExactlyOnceWith('/api/capi/config/google', {
            accountId: 'store-a', enabled: true, config: { customerId: '1234567890', conversionActionId: '123' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Meta \(Facebook/ }));
        expect(screen.getByDisplayValue('meta-pixel')).toBeInTheDocument();
    });
});
