import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installDeploymentRecovery } from './utils/deploymentRecovery'
import App from './App.tsx'
import './index.css'

// Install deployment recovery handlers BEFORE React initializes.
// This catches chunk load errors from stale caches after redeployment.
installDeploymentRecovery();

/**
 * Why these defaults: staleTime prevents refetching on every mount,
 * single retry avoids hammering failing endpoints, and gcTime keeps
 * unused cache around long enough for tab-switching.
 */
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 60 * 1000,
            retry: 1,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
        },
    },
});

// Initialize Sentry if DSN is provided
if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration(),
        ],
        // Performance Monitoring
        tracesSampleRate: 1.0, //  Capture 100% of the transactions
        // Session Replay
        replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
        replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, always sample the session when an error occurs.
    });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <App />
        </QueryClientProvider>
    </React.StrictMode>,
)
