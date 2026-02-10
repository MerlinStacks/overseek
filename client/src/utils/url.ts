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
    // Explicit override takes priority
    if (import.meta.env.VITE_PUBLIC_API_URL) {
        return import.meta.env.VITE_PUBLIC_API_URL;
    }

    // Use the dashboard origin — nginx proxies /api to the backend
    return window.location.origin;
}

/**
 * Gets the internal API URL for direct requests from the browser.
 * In Docker, this may be the container service name (e.g., `http://api:3000`),
 * but requests are proxied through Vite/Nginx so they still work.
 */
export function getInternalApiUrl(): string {
    return import.meta.env.VITE_API_URL || window.location.origin;
}
