/**
 * Misc Costs Utility
 *
 * Safely parses and sums a `miscCosts` JSON field (stored as `Json?` in Prisma).
 * The expected shape is `Array<{ amount: number; note: string }>`.
 */

/**
 * Sums the `amount` values from a miscCosts JSON field.
 * Handles null, undefined, non-array, and malformed entries gracefully.
 *
 * @param miscCosts - Raw Json? value from Prisma (unknown at runtime)
 * @returns Total of all valid `amount` values, or 0 if none
 */
export function sumMiscCosts(miscCosts: unknown): number {
    if (!Array.isArray(miscCosts)) return 0;

    return miscCosts.reduce((total, entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return total;
        const value: unknown = entry.amount;
        const amount = typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) ? Number(value) : NaN;
        if (!Number.isFinite(amount)) return total;
        if (!Number.isFinite(total + amount)) throw new RangeError('Miscellaneous cost total exceeds numeric range');
        return total + amount;
    }, 0);
}
