/**
 * Gold Price Calculations Utility
 * 
 * Centralized functions for calculating gold COGS and profit margins.
 * Used by both the gold price report endpoints and potentially other services.
 */

/** Gold purity percentages by type */
export const GOLD_PURITY: Record<string, number> = {
    '24ct': 1.0,      // 100% gold (reference)
    '18ct': 0.75,     // 75% gold
    '9ct': 0.375,     // 37.5% gold
    '18ctWhite': 0.75,
    '9ctWhite': 0.375
};

/** Account gold price rates structure */
export interface AccountGoldPrices {
    goldPrice18ct: number;
    goldPrice9ct: number;
    goldPrice18ctWhite: number;
    goldPrice9ctWhite: number;
}

/**
 * Calculates gold COGS based on weight and gold type.
 * 
 * @param weight - Weight in grams (or configured unit)
 * @param goldPriceType - Gold type: '18ct', '9ct', '18ctWhite', '9ctWhite'
 * @param accountPrices - Account's configured gold prices per gram
 * @returns Calculated COGS value
 */
export function calculateGoldCogs(
    weight: number | null,
    goldPriceType: string | null,
    accountPrices: AccountGoldPrices
): number {
    if (!weight || !goldPriceType) return 0;

    const pricePerGram: Record<string, number> = {
        '18ct': accountPrices.goldPrice18ct,
        '9ct': accountPrices.goldPrice9ct,
        '18ctWhite': accountPrices.goldPrice18ctWhite,
        '9ctWhite': accountPrices.goldPrice9ctWhite
    };

    return weight * (pricePerGram[goldPriceType] || 0);
}

/**
 * Calculates profit margin percentage.
 * 
 * @param price - Selling price
 * @param cogs - Cost of goods sold
 * @returns Profit margin as percentage (0-100)
 */
export function calculateMargin(price: number, cogs: number): number {
    if (!price || price === 0) return 0;
    return ((price - cogs) / price) * 100;
}

/**
 * Converts account Prisma Decimal fields to numeric AccountGoldPrices.
 * 
 * @param account - Account with Decimal gold price fields
 * @returns Numeric gold prices
 */
export function parseAccountGoldPrices(account: {
    goldPrice18ct?: unknown;
    goldPrice9ct?: unknown;
    goldPrice18ctWhite?: unknown;
    goldPrice9ctWhite?: unknown;
}): AccountGoldPrices {
    return {
        goldPrice18ct: Number(account.goldPrice18ct) || 0,
        goldPrice9ct: Number(account.goldPrice9ct) || 0,
        goldPrice18ctWhite: Number(account.goldPrice18ctWhite) || 0,
        goldPrice9ctWhite: Number(account.goldPrice9ctWhite) || 0
    };
}
