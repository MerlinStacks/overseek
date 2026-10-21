export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function finiteFields(value: Record<string, unknown>, keys: string[]): boolean {
    return keys.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]));
}

/** Reject partial numbers, empty values, infinities and negative monetary inputs. */
export function nonnegativeNumber(value: unknown): number | null {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}
