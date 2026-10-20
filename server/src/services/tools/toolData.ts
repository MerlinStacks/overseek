export function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function finiteAmount(value: unknown): number | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function toolLimit(value: unknown, maximum = 50): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : 5;
}

export function currencyCode(value: unknown): string | null {
    const code = text(value).toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : null;
}

export function shiftDate(dateKey: string, days: number): string {
    const date = new Date(`${dateKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
