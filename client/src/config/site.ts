/**
 * Site Configuration
 * 
 * Centralizes environment-based branding and contact information.
 * All configurable values fallback to sensible defaults for self-hosting.
 */

export const siteConfig = {
    // Branding
    appName: import.meta.env.VITE_APP_NAME?.trim() || 'Commerce Platform',

    // Contact emails (for legal pages)
    supportEmail: import.meta.env.VITE_SUPPORT_EMAIL?.trim() || 'support@localhost',
    legalEmail: import.meta.env.VITE_LEGAL_EMAIL?.trim() || 'legal@localhost',
    privacyEmail: import.meta.env.VITE_PRIVACY_EMAIL?.trim() || 'privacy@localhost',
    // Supplied by the operator when the published policy is actually revised.
    privacyPolicyUpdatedAt: import.meta.env.VITE_PRIVACY_POLICY_UPDATED_AT?.trim() || '',
    termsUpdatedAt: import.meta.env.VITE_TERMS_UPDATED_AT?.trim() || '',

    // URLs
    apiUrl: import.meta.env.VITE_API_URL?.trim() || '',
    publicApiUrl: import.meta.env.VITE_PUBLIC_API_URL?.trim() || import.meta.env.VITE_API_URL?.trim() || '',
};
