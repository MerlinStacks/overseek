import { describe, expect, it, vi } from 'vitest';
import { GoogleAdsAuth } from './GoogleAdsAuth';
vi.mock('./types', () => ({ getCredentials: async () => ({ clientId: 'oauth-client' }) }));
vi.mock('../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
describe('Google Ads audience authorisation', () => {
    it('requests both Ads and Data Manager permissions on reconnection', async () => {
        const url = new URL(await GoogleAdsAuth.getAuthUrl('https://example.com/callback', 'nonce'));
        expect(url.searchParams.get('scope')?.split(' ')).toEqual(['https://www.googleapis.com/auth/adwords', 'https://www.googleapis.com/auth/datamanager']);
        expect(url.searchParams.get('include_granted_scopes')).toBe('true');
        expect(url.searchParams.get('state')).toBe('nonce');
        expect(url.searchParams.get('prompt')).toBe('consent');
    });
});
