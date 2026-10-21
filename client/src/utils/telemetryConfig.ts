/** Error telemetry is production-only by default. Tracing and replay are explicit opt-ins. */
export function telemetryConfig(env: Record<string, unknown>, replayConsent = false) {
    if (env.VITE_SENTRY_ENABLED === 'false' || !env.VITE_SENTRY_DSN || env.PROD !== true && env.VITE_SENTRY_ENABLED !== 'true') return null;
    const dsn = String(env.VITE_SENTRY_DSN);
    try {
        const url = new URL(dsn);
        if (url.protocol !== 'https:' || !url.username || !url.hostname || !/^\/\d+$/.test(url.pathname)) return null;
    } catch { return null; }
    const rate = (key: string) => {
        const value = env[key];
        if (typeof value !== 'string' || !/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value)) return 0;
        return Number(value);
    };
    return { dsn, sendDefaultPii: false, tracesSampleRate: rate('VITE_SENTRY_TRACES_SAMPLE_RATE'),
        replaysSessionSampleRate: replayConsent ? rate('VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE') : 0,
        replaysOnErrorSampleRate: replayConsent ? rate('VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE') : 0 };
}
