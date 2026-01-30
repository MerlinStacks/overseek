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
 * - In localhost/dev: Uses window.location.origin
 * - In production: Prepends 'api.' to the current hostname
 *   (e.g., overseek.plateit.au -> api.overseek.plateit.au)
 * 
 * Why: Internal Docker URLs like `http://api:3000` are not accessible from
 * external services like WooCommerce. This function derives a publicly-routable
 * URL from the current browser context.
 */
export function getPublicApiUrl(): string {
    // Explicit override takes priority
    if (import.meta.env.VITE_PUBLIC_API_URL) {
        return import.meta.env.VITE_PUBLIC_API_URL;
    }

    const { protocol, hostname, port } = window.location;

    // Localhost: use origin directly (dev environment)
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return window.location.origin;
    }

    // Production: derive API subdomain from current hostname
    // e.g., overseek.plateit.au -> api.overseek.plateit.au
    const apiHostname = `api.${hostname}`;
    const portSuffix = port && port !== '443' && port !== '80' ? `:${port}` : '';
    return `${protocol}//${apiHostname}${portSuffix}`;
}

/**
 * Gets the internal API URL for direct requests from the browser.
 * In Docker, this may be the container service name (e.g., `http://api:3000`),
 * but requests are proxied through Vite/Nginx so they still work.
 */
export function getInternalApiUrl(): string {
    return import.meta.env.VITE_API_URL || window.location.origin;
}
