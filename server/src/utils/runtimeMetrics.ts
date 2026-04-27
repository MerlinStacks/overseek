import { Logger } from './logger';

type MetricsProvider = () => Record<string, unknown>;

const providers = new Map<string, MetricsProvider>();

export function registerRuntimeMetricsProvider(name: string, provider: MetricsProvider): void {
    providers.set(name, provider);
}

export function getRuntimeMetricsSnapshot(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};

    for (const [name, provider] of providers.entries()) {
        try {
            snapshot[name] = provider();
        } catch (error) {
            Logger.warn('[RuntimeMetrics] Provider failed', { name, error });
            snapshot[name] = { error: 'provider_failed' };
        }
    }

    return snapshot;
}

