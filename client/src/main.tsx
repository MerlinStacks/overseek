import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installDeploymentRecovery } from './utils/deploymentRecovery'
import App from './App.tsx'
import './index.css'
import { telemetryConfig } from './utils/telemetryConfig'

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: 1,
        },
    },
});

// Install deployment recovery handlers BEFORE React initializes.
installDeploymentRecovery();

try {
    // The site's consent manager must set this only after explicit user consent.
    const config = telemetryConfig(import.meta.env, sessionStorage.getItem('telemetry-replay-consent') === 'granted');
    if (config) Sentry.init({ ...config, integrations: [
        ...(config.tracesSampleRate > 0 ? [Sentry.browserTracingIntegration()] : []),
        ...(config.replaysSessionSampleRate > 0 || config.replaysOnErrorSampleRate > 0 ? [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })] : []),
    ] });
} catch { console.warn('Telemetry unavailable; continuing application startup.'); }

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <App />
        </QueryClientProvider>
    </React.StrictMode>,
)
