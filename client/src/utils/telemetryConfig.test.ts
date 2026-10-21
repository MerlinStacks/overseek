import { describe, expect, it } from 'vitest';
import { telemetryConfig } from './telemetryConfig';
const env = { PROD: true, VITE_SENTRY_DSN: 'https://public@example.com/123' };
describe('explicit telemetry sampling and replay consent', () => {
    it('disables tracing/replay by default and development telemetry without opt-in', () => {
        expect(telemetryConfig(env)).toMatchObject({ tracesSampleRate: 0, replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0, sendDefaultPii: false });
        expect(telemetryConfig({ ...env, PROD: false })).toBeNull();
    });
    it('requires both validated rates and runtime consent for replay', () => {
        const config = { ...env, VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE: '0.1', VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE: '1', VITE_SENTRY_TRACES_SAMPLE_RATE: '9' };
        expect(telemetryConfig(config)).toMatchObject({ replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0, tracesSampleRate: 0 });
        expect(telemetryConfig(config, true)).toMatchObject({ replaysSessionSampleRate: 0.1, replaysOnErrorSampleRate: 1 });
    });
    it('fails closed for invalid DSNs or disabled configuration', () => { expect(telemetryConfig({ ...env, VITE_SENTRY_DSN: 'invalid' })).toBeNull(); expect(telemetryConfig({ ...env, VITE_SENTRY_ENABLED: 'false' })).toBeNull(); });
});
