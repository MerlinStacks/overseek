import { afterEach, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { getApiBase, getAppUrl, buildCallbackUrl, buildFrontendUrl } from '../oauthHelpers';
vi.mock('../../utils/prisma', () => ({ prisma: {} }));
vi.mock('../../services/PermissionService', () => ({ PermissionService: {} }));
afterEach(() => vi.unstubAllEnvs());
const request = { protocol: 'https', hostname: 'attacker.test' } as FastifyRequest;
it('uses configured origins, never request host, with local-only development defaults', () => {
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('API_URL', ''); vi.stubEnv('APP_URL', '');
    expect(getApiBase(request)).toBe('http://localhost:3000'); expect(getAppUrl()).toBe('http://localhost:5173');
    vi.stubEnv('API_URL', 'https://api.test/'); expect(buildCallbackUrl(request, 'meta/ads/callback')).toBe('https://api.test/api/oauth/meta/ads/callback');
    expect(buildCallbackUrl(request, 'search-console/callback')).toBe('https://api.test/api/oauth/search-console/callback');
});
it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/bad\npath'])('rejects unsafe frontend destination %s', path => { expect(() => buildFrontendUrl(path)).toThrow(); });
it('encodes query parameters on relative paths', () => {
    vi.stubEnv('APP_URL', 'https://app.test'); expect(buildFrontendUrl('/settings?tab=ads', { error: 'a&b' })).toBe('https://app.test/settings?tab=ads&error=a%26b');
});
it('requires explicit safe production origins', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('API_URL', ''); expect(() => getApiBase(request)).toThrow();
    for (const value of ['http://app.test', 'https://user:pass@app.test', 'https://app.test/path', 'https://app.test?query=1']) { vi.stubEnv('APP_URL', value); expect(() => getAppUrl()).toThrow(); }
});
