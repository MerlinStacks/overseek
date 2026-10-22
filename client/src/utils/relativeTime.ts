import { z } from 'zod';
const timestamp = z.string().max(100).datetime({ offset: true });
export type ObservationAge = { state: 'never' | 'unknown' | 'future'; milliseconds: null } | { state: 'observed'; milliseconds: number };
/** One minute is tolerated for clock skew, not arbitrary future freshness. */
export function observationAge(value: unknown, now = Date.now()): ObservationAge {
    if (value === null || value === undefined) return { state: 'never', milliseconds: null };
    if (!timestamp.safeParse(value).success || typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || !Number.isFinite(now)) return { state: 'unknown', milliseconds: null };
    const age = now - Date.parse(value);
    return age < -60000 ? { state: 'future', milliseconds: null } : { state: 'observed', milliseconds: Math.max(0, age) };
}
export function formatRelativeTime(value: string | null | undefined, now = Date.now()): string {
    const age = observationAge(value, now);
    if (age.state !== 'observed') return age.state === 'never' ? 'Never' : age.state === 'future' ? 'Future timestamp (clock unknown)' : 'Time unavailable';
    const minutes = Math.floor(age.milliseconds / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
    return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : hours < 24 ? `${hours}h ago` : days === 1 ? 'Yesterday' : days < 7 ? `${days}d ago` : new Date(value!).toLocaleDateString();
}
export function getStalenessLevel(value: string | null | undefined, now = Date.now()): 'fresh' | 'stale' | 'critical' | 'never' | 'unknown' | 'future' {
    const age = observationAge(value, now);
    return age.state !== 'observed' ? age.state : age.milliseconds < 3600000 ? 'fresh' : age.milliseconds < 21600000 ? 'stale' : 'critical';
}
