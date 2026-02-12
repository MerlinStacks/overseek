/**
 * Unit tests for OAuth URL helpers.
 *
 * Why: The original inline string-concatenation produced malformed redirect
 * URLs behind proxies (wrong separators, whitespace). These tests lock in
 * correct behaviour for every edge case.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getApiBase, buildCallbackUrl, getAppUrl, buildFrontendUrl } from '../oauthHelpers';
import { FastifyRequest } from 'fastify';

/** Minimal mock that satisfies the subset of FastifyRequest we use */
function mockRequest(opts: { protocol?: string; hostname?: string } = {}): FastifyRequest {
    return {
        protocol: opts.protocol ?? 'https',
        hostname: opts.hostname ?? 'myapp.example.com',
    } as unknown as FastifyRequest;
}

describe('getApiBase', () => {
    afterEach(() => { delete process.env.API_URL; });

    it('returns API_URL when set', () => {
        process.env.API_URL = 'https://api.prod.example.com';
        expect(getApiBase(mockRequest())).toBe('https://api.prod.example.com');
    });

    it('strips trailing slashes from API_URL', () => {
        process.env.API_URL = 'https://api.prod.example.com///';
        expect(getApiBase(mockRequest())).toBe('https://api.prod.example.com');
    });

    it('trims whitespace from API_URL', () => {
        process.env.API_URL = '  https://api.prod.example.com  ';
        expect(getApiBase(mockRequest())).toBe('https://api.prod.example.com');
    });

    it('falls back to request origin when API_URL is not set', () => {
        expect(getApiBase(mockRequest({ protocol: 'http', hostname: 'localhost:3000' })))
            .toBe('http://localhost:3000');
    });
});

describe('buildCallbackUrl', () => {
    afterEach(() => { delete process.env.API_URL; });

    it('builds correct URL with API_URL', () => {
        process.env.API_URL = 'https://api.prod.example.com';
        expect(buildCallbackUrl(mockRequest(), 'google/callback'))
            .toBe('https://api.prod.example.com/api/oauth/google/callback');
    });

    it('builds correct URL from request fallback', () => {
        expect(buildCallbackUrl(mockRequest({ protocol: 'https', hostname: 'myapp.example.com' }), 'meta/ads/callback'))
            .toBe('https://myapp.example.com/api/oauth/meta/ads/callback');
    });

    it('trims any whitespace from the result', () => {
        process.env.API_URL = '  https://api.example.com  ';
        const url = buildCallbackUrl(mockRequest(), 'google/callback');
        expect(url).not.toMatch(/\s/);
        expect(url).toBe('https://api.example.com/api/oauth/google/callback');
    });
});

describe('getAppUrl', () => {
    afterEach(() => { delete process.env.APP_URL; });

    it('returns APP_URL when set', () => {
        process.env.APP_URL = 'https://app.example.com';
        expect(getAppUrl()).toBe('https://app.example.com');
    });

    it('strips trailing slashes', () => {
        process.env.APP_URL = 'https://app.example.com/';
        expect(getAppUrl()).toBe('https://app.example.com');
    });

    it('defaults to localhost:5173', () => {
        expect(getAppUrl()).toBe('http://localhost:5173');
    });
});

describe('buildFrontendUrl', () => {
    afterEach(() => { delete process.env.APP_URL; });

    it('appends query params with proper separator (no existing query)', () => {
        process.env.APP_URL = 'https://app.example.com';
        const url = buildFrontendUrl('/marketing', { error: 'oauth_denied' });
        expect(url).toBe('https://app.example.com/marketing?error=oauth_denied');
    });

    it('appends query params with proper separator (existing query)', () => {
        process.env.APP_URL = 'https://app.example.com';
        const url = buildFrontendUrl('/settings?tab=ads', { success: 'connected', id: '123' });
        // URL API preserves existing params and adds new ones
        expect(url).toContain('tab=ads');
        expect(url).toContain('success=connected');
        expect(url).toContain('id=123');
        // No double ? or malformed separators
        expect(url.match(/\?/g)?.length).toBe(1);
    });

    it('encodes special characters in param values', () => {
        process.env.APP_URL = 'https://app.example.com';
        const url = buildFrontendUrl('/error', { message: 'token exchange failed (403)' });
        expect(url).not.toContain(' ');
        expect(url).not.toContain('(');
        expect(url).toContain('message=');
    });

    it('handles absolute path input', () => {
        const url = buildFrontendUrl('https://other.example.com/foo', { bar: 'baz' });
        expect(url).toBe('https://other.example.com/foo?bar=baz');
    });

    it('produces no whitespace in output', () => {
        process.env.APP_URL = '  https://app.example.com  ';
        const url = buildFrontendUrl('/callback', { flowName: 'GeneralOAuthFlow' });
        expect(url).not.toMatch(/\s/);
    });
});
