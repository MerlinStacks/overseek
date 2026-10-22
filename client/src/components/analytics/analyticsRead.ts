import { isRecord } from '../../utils/responseValidation';
export function record(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw new Error('Analytics data unavailable'); return value; }
export function metric(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid analytics metric'); return value; }
export function count(value: unknown): number { const number = metric(value); if (!Number.isSafeInteger(number)) throw new Error('Invalid analytics count'); return number; }
export function rows(value: unknown): Record<string, unknown>[] { if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid analytics rows'); return value.map(record); }
export function label(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid analytics label'); return value; }
export function money(value: number, currency: string): string {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('currency');
    if (!/^[A-Z]{3}$/.test(currency || '') || supported && !supported.includes(currency)) return `${value.toFixed(2)} (currency unavailable)`;
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
}
export const validDays = (days: number) => days === -1 || Number.isInteger(days) && days >= 1 && days <= 365;
