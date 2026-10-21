import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const keys = ['VITE_APP_NAME', 'VITE_SUPPORT_EMAIL', 'VITE_LEGAL_EMAIL', 'VITE_PRIVACY_EMAIL', 'VITE_PRIVACY_POLICY_UPDATED_AT', 'VITE_TERMS_UPDATED_AT', 'VITE_API_URL', 'VITE_PUBLIC_API_URL'] as const;
beforeEach(() => { vi.resetModules(); for (const key of keys) vi.stubEnv(key, undefined); });
afterEach(() => vi.unstubAllEnvs());
describe('site configuration', () => {
    it('preserves the self-hosting defaults when configuration is absent', async () => {
        const { siteConfig } = await import('./site');
        expect(siteConfig).toEqual({ appName: 'Commerce Platform', supportEmail: 'support@localhost', legalEmail: 'legal@localhost', privacyEmail: 'privacy@localhost', privacyPolicyUpdatedAt: '', termsUpdatedAt: '', apiUrl: '', publicApiUrl: '' });
    });
    it('treats whitespace-only configuration as absent', async () => {
        for (const key of keys) vi.stubEnv(key, ' \t\n ');
        const { siteConfig } = await import('./site');
        expect(siteConfig.appName).toBe('Commerce Platform'); expect(siteConfig.supportEmail).toBe('support@localhost');
        expect(siteConfig.legalEmail).toBe('legal@localhost'); expect(siteConfig.privacyEmail).toBe('privacy@localhost');
        expect(siteConfig.apiUrl).toBe(''); expect(siteConfig.publicApiUrl).toBe('');
        expect(siteConfig.privacyPolicyUpdatedAt).toBe(''); expect(siteConfig.termsUpdatedAt).toBe('');
    });
    it('trims configured values while preserving internal whitespace and URL paths', async () => {
        vi.stubEnv('VITE_APP_NAME', '  My Commerce App  '); vi.stubEnv('VITE_SUPPORT_EMAIL', ' support@example.com ');
        vi.stubEnv('VITE_LEGAL_EMAIL', ' legal@example.com '); vi.stubEnv('VITE_PRIVACY_EMAIL', ' privacy@example.com ');
        vi.stubEnv('VITE_API_URL', ' https://api.example.com/v1/ '); vi.stubEnv('VITE_PUBLIC_API_URL', ' https://public.example.com/api ');
        vi.stubEnv('VITE_PRIVACY_POLICY_UPDATED_AT', ' 2026-09-20 ');
        vi.stubEnv('VITE_TERMS_UPDATED_AT', ' 2026-09-21 ');
        const { siteConfig } = await import('./site');
        expect(siteConfig).toEqual({ appName: 'My Commerce App', supportEmail: 'support@example.com', legalEmail: 'legal@example.com', privacyEmail: 'privacy@example.com', privacyPolicyUpdatedAt: '2026-09-20', termsUpdatedAt: '2026-09-21', apiUrl: 'https://api.example.com/v1/', publicApiUrl: 'https://public.example.com/api' });
    });
    it('falls back to the trimmed API URL for a blank public API URL', async () => {
        vi.stubEnv('VITE_API_URL', ' /api '); vi.stubEnv('VITE_PUBLIC_API_URL', '  ');
        const { siteConfig } = await import('./site'); expect(siteConfig.publicApiUrl).toBe('/api');
    });
});
