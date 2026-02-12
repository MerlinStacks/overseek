/**
 * OAuth URL Construction Helpers
 *
 * Why: All OAuth route files duplicated URL-building logic using raw string
 * concatenation, which silently produced malformed redirect URLs behind
 * reverse proxies (wrong host/port, missing `?` separator, whitespace).
 * This module centralises that logic with the `URL` API for correctness.
 */

import { FastifyRequest } from 'fastify';

/**
 * Derive the external-facing API base URL.
 * Prefers `API_URL` env (set by the admin for proxy setups), otherwise
 * falls back to per-request origin built from Fastify's protocol/hostname.
 */
export function getApiBase(request: FastifyRequest): string {
    const envUrl = process.env.API_URL?.replace(/\/+$/, '').trim();
    if (envUrl) return envUrl;
    return `${request.protocol}://${request.hostname}`;
}

/**
 * Build a fully-qualified OAuth callback URL.
 *
 * @param request  - Current Fastify request (used as fallback origin).
 * @param pathSuffix - Path segment after `/api/oauth/`, e.g. `google/callback`.
 * @returns Absolute URL with no trailing whitespace.
 */
export function buildCallbackUrl(request: FastifyRequest, pathSuffix: string): string {
    const base = getApiBase(request);
    return `${base}/api/oauth/${pathSuffix}`.trim();
}

/**
 * Derive the external-facing frontend/app base URL.
 * Uses `APP_URL` env, defaults to the dev server.
 */
export function getAppUrl(): string {
    return (process.env.APP_URL?.replace(/\/+$/, '').trim()) || 'http://localhost:5173';
}

/**
 * Build a frontend redirect URL with properly-encoded query parameters.
 *
 * Why: Naively appending `&key=value` breaks when the path does not already
 * contain a `?`.  Using the `URL` API guarantees correct separators and
 * encoding regardless of the shape of `path`.
 *
 * @param path   - Relative path (e.g. `/marketing?tab=ads`) or absolute URL.
 * @param params - Key/value pairs to append as query parameters.
 * @returns Absolute URL ready for `reply.redirect()`.
 */
export function buildFrontendUrl(
    path: string,
    params: Record<string, string> = {}
): string {
    const appUrl = getAppUrl();

    // If path is already absolute, use it directly; otherwise prepend appUrl
    const fullUrl = path.startsWith('http') ? path : `${appUrl}${path}`;

    const url = new URL(fullUrl);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}
