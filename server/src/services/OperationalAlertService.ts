type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

interface OperationalAlertInput {
    title: string;
    severity: AlertSeverity;
    category: string;
    message?: string;
    fingerprint?: string;
    metadata?: Record<string, unknown>;
}

const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_METADATA_STRING_LENGTH = 1_000;
const recentAlerts = new Map<string, number>();

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isEnabled(): boolean {
    if (!process.env.OPERATIONAL_ALERT_WEBHOOK_URL) return false;
    const raw = (process.env.OPERATIONAL_ALERTS_ENABLED || 'true').trim().toLowerCase();
    return !['0', 'false', 'off', 'no'].includes(raw);
}

function getEnvironmentName(): string {
    return process.env.OPERATIONAL_ALERT_ENV || process.env.NODE_ENV || 'development';
}

function scrubValue(value: unknown): unknown {
    if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
    }

    if (typeof value === 'string') {
        return value.length > MAX_METADATA_STRING_LENGTH
            ? `${value.slice(0, MAX_METADATA_STRING_LENGTH)}...`
            : value;
    }

    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.slice(0, 20).map(scrubValue);

    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (/password|secret|token|key|authorization|cookie/i.test(key)) {
            result[key] = '[redacted]';
            continue;
        }
        result[key] = scrubValue(nestedValue);
    }
    return result;
}

function buildText(input: OperationalAlertInput): string {
    const app = process.env.APP_NAME || 'OverSeek';
    const env = getEnvironmentName();
    return `[${app} ${env}] ${input.severity.toUpperCase()}: ${input.title}${input.message ? ` - ${input.message}` : ''}`;
}

function shouldSend(fingerprint: string): boolean {
    const cooldownMs = parsePositiveInt(process.env.OPERATIONAL_ALERT_COOLDOWN_MS, DEFAULT_COOLDOWN_MS);
    const now = Date.now();
    const previous = recentAlerts.get(fingerprint) || 0;
    if (now - previous < cooldownMs) return false;

    recentAlerts.set(fingerprint, now);
    return true;
}

async function postWebhook(input: OperationalAlertInput): Promise<void> {
    const webhookUrl = process.env.OPERATIONAL_ALERT_WEBHOOK_URL;
    if (!webhookUrl) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), parsePositiveInt(process.env.OPERATIONAL_ALERT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS));
    timeout.unref?.();

    try {
        const payload = {
            text: buildText(input),
            title: input.title,
            severity: input.severity,
            category: input.category,
            environment: getEnvironmentName(),
            service: process.env.OPERATIONAL_ALERT_SERVICE || 'overseek-server',
            timestamp: new Date().toISOString(),
            message: input.message,
            metadata: scrubValue(input.metadata || {}),
        };

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!response.ok) {
            process.stderr.write(`[OperationalAlertService] Webhook failed with ${response.status}\n`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[OperationalAlertService] Webhook send failed: ${message}\n`);
    } finally {
        clearTimeout(timeout);
    }
}

export function sendOperationalAlert(input: OperationalAlertInput): void {
    if (!isEnabled()) return;

    const fingerprint = input.fingerprint || `${input.category}:${input.title}:${input.message || ''}`;
    if (!shouldSend(fingerprint)) return;

    void postWebhook(input);
}

export function resetOperationalAlertStateForTests(): void {
    recentAlerts.clear();
}
