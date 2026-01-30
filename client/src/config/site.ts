/**
 * Site Configuration
 * 
 * Centralizes environment-based branding and contact information.
 * All configurable values fallback to sensible defaults for self-hosting.
 */

export const siteConfig = {
    // Branding
    appName: import.meta.env.VITE_APP_NAME || 'Commerce Platform',

    // Contact emails (for legal pages)
    supportEmail: import.meta.env.VITE_SUPPORT_EMAIL || 'support@localhost',
    legalEmail: import.meta.env.VITE_LEGAL_EMAIL || 'legal@localhost',
    privacyEmail: import.meta.env.VITE_PRIVACY_EMAIL || 'privacy@localhost',

    // URLs
    apiUrl: import.meta.env.VITE_API_URL || '',
    publicApiUrl: import.meta.env.VITE_PUBLIC_API_URL || import.meta.env.VITE_API_URL || '',
};
