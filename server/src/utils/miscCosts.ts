/**
 * Misc Costs Utility
 *
 * Safely parses and sums a `miscCosts` JSON field (stored as `Json?` in Prisma).
 * The expected shape is `Array<{ amount: number; note: string }>`.
 */

interface MiscCostEntry {
    amount: number;
    note: string;
}

/**
 * Sums the `amount` values from a miscCosts JSON field.
 * Handles null, undefined, non-array, and malformed entries gracefully.
 *
 * @param miscCosts - Raw Json? value from Prisma (unknown at runtime)
 * @returns Total of all valid `amount` values, or 0 if none
 */
export function sumMiscCosts(miscCosts: unknown): number {
    if (!Array.isArray(miscCosts)) return 0;

    return (miscCosts as MiscCostEntry[]).reduce((total, entry) => {
        const amount = Number(entry?.amount);
        return total + (isNaN(amount) ? 0 : amount);
    }, 0);
}
