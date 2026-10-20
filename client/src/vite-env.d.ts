/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_APP_NAME?: string;
    readonly VITE_SUPPORT_EMAIL?: string;
    readonly VITE_LEGAL_EMAIL?: string;
    readonly VITE_PRIVACY_EMAIL?: string;
    readonly VITE_API_URL?: string;
    readonly VITE_PUBLIC_API_URL?: string;
    readonly VITE_SENTRY_DSN?: string;
    readonly VITE_INVOICE_ALLOW_VECTOR_FALLBACK?: string;
}
