import { createHash } from 'crypto';

/** Stable across retries, batch ordering and worker restarts. */
export function campaignSubjectVariant(campaignId: string, email: string): 'A' | 'B' {
    return createHash('sha256').update(`${campaignId}\n${email.trim().toLowerCase()}`).digest()[0] < 128 ? 'A' : 'B';
}

export function marketingPressureConfig() {
    const max = Number.parseInt(process.env.MARKETING_PRESSURE_MAX_SENDS || '3', 10);
    const hours = Number.parseInt(process.env.MARKETING_PRESSURE_WINDOW_HOURS || '24', 10);
    return { maxPerWindow: Number.isFinite(max) && max > 0 ? max : 3, windowHours: Number.isFinite(hours) && hours > 0 ? hours : 24 };
}
