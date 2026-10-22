/**
 * URL Utilities
 * 
 * Helpers for deriving API URLs from current browser location.
 * Avoids hardcoding deployment-specific URLs.
 */

/**
 * Derives the public API URL for external clients (e.g., WooCommerce plugin).
 * 
 * Logic:
 * - If VITE_PUBLIC_API_URL is explicitly set, uses that
 * - Otherwise: Uses window.location.origin (works for both dev and production)
 * 
 * Why: The standard deployment uses nginx to proxy /api requests to the backend.
 * External clients (WooCommerce plugin) reach the API through the same origin
 * as the dashboard — no separate api. subdomain is needed.
 */
export function getPublicApiUrl(): string {
    const raw = import.meta.env.VITE_PUBLIC_API_URL || window.location.origin;
    try { const url = new URL(raw); const localDev = import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:'; return (url.protocol === 'https:' || localDev) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : ''; } catch { return ''; }
}

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SAFE_NAVIGATION_PROTOCOLS = new Set(['http:', 'https:']);

export function getSafeHref(value: string | null | undefined, fallback = '#'): string {
    if (typeof value !== 'string' || !value || value.length > 4096 || [...value].some(char => char.charCodeAt(0) < 32)) return fallback;

    try {
        const url = new URL(value, window.location.origin);
        return SAFE_LINK_PROTOCOLS.has(url.protocol) && !url.username && !url.password ? url.href : fallback;
    } catch {
        return fallback;
    }
}

export function getSafeNavigationUrl(value: string | null | undefined): string | null {
    if (typeof value !== 'string' || !value || value.length > 4096 || [...value].some(char => char.charCodeAt(0) < 32)) return null;

    try {
        const url = new URL(value, window.location.origin);
        return SAFE_NAVIGATION_PROTOCOLS.has(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch {
        return null;
    }
}

export function navigateToSafeUrl(value: string | null | undefined): boolean {
    const safeUrl = getSafeNavigationUrl(value);
    if (!safeUrl) return false;
    window.location.href = safeUrl;
    return true;
}

export function openSafeUrl(value: string | null | undefined, target = '_blank', features = 'noopener,noreferrer'): boolean {
    const safeUrl = getSafeNavigationUrl(value);
    if (!safeUrl) return false;
    if (target !== '_blank') return false;
    // Open an inert same-origin window first: noopener itself can make window.open
    // return null even on success. Sever the opener before navigating externally.
    const opened = window.open('', target, features.split(',').filter(value => !['noopener', 'noreferrer'].includes(value.trim())).join(','));
    if (!opened) return false;
    try { opened.opener = null; const meta = opened.document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; opened.document.head.appendChild(meta); opened.location.replace(safeUrl); return true; } catch { opened.close(); return false; }
}

/** Destination approval for authorization only; does not replace backend OAuth state. */
export function getOAuthNavigationUrl(value: string | null | undefined): string | null {
    const safe = getSafeNavigationUrl(value); if (!safe) return null;
    const url = new URL(safe);
    if (url.hash || url.protocol !== 'https:') return null;
    const approved = url.origin === 'https://accounts.google.com' && url.pathname === '/o/oauth2/v2/auth' || url.origin === 'https://www.facebook.com' && /^\/v\d{1,3}\.\d{1,2}\/dialog\/oauth$/.test(url.pathname) || url.origin === 'https://www.tiktok.com' && url.pathname === '/v2/auth/authorize/';
    return approved ? url.href : null;
}
export function navigateToOAuthUrl(value: string | null | undefined): boolean { const url = getOAuthNavigationUrl(value); if (!url) return false; window.location.assign(url); return true; }
