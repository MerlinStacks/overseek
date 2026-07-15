export function parseWooDate(value: unknown): Date | null {
    if (typeof value !== 'string' || !value.trim()) return null;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
