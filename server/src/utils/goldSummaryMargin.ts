import { Prisma } from '@prisma/client';

/** Summary-only strict calculation: an unknown rate/weight/cost is not free stock. */
export function goldSummaryMargin(price: unknown, weight: unknown, type: string | null, misc: unknown, account: Record<string, unknown>): number | null {
    const number = (value: unknown): number | null => {
        if (typeof value !== 'number' && !Prisma.Decimal.isDecimal(value) && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };
    const rateKeys: Record<string, string> = { '18ct': 'goldPrice18ct', '9ct': 'goldPrice9ct', '18ctWhite': 'goldPrice18ctWhite', '9ctWhite': 'goldPrice9ctWhite' };
    const selling = number(price); const grams = number(weight); const rate = type && rateKeys[type] ? number(account[rateKeys[type]]) : null;
    if (selling === null || selling <= 0 || grams === null || rate === null || (misc != null && !Array.isArray(misc))) return null;
    let cost = grams * rate;
    for (const entry of (misc ?? []) as unknown[]) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        const amount = (entry as Record<string, unknown>).amount;
        if (typeof amount !== 'number' && (typeof amount !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(amount.trim()))) return null;
        if (!Number.isFinite(Number(amount))) return null;
        cost += Number(amount);
    }
    const margin = (selling - cost) / selling * 100;
    return Number.isFinite(margin) && Number.isFinite(cost) ? margin : null;
}
