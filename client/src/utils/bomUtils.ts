import { isRecord } from './responseValidation';
export interface BomCostResult { total: number | null; currency: string | null; complete: boolean; unavailable: string[] }
function decimal(value: unknown, max: number): number | null {
    if (typeof value !== 'number' && typeof value !== 'string' || !/^\d+(?:\.\d{1,8})?$/.test(String(value))) return null;
    const number = Number(value); return Number.isFinite(number) && number <= max ? number : null;
}
/** Explicit per-component-unit costs only; this does not resolve nested BOMs or convert currencies. */
export function calculateTotalBomCost(items: unknown, currency?: string): BomCostResult {
    const unavailable: string[] = [];
    if (!Array.isArray(items) || items.length > 500) return { total: null, currency: null, complete: false, unavailable: ['Invalid/oversized component set'] };
    if (!currency || !/^[A-Z]{3}$/.test(currency)) unavailable.push('Explicit common source currency required');
    let total = 0;
    items.forEach((item, index) => {
        if (!isRecord(item)) { unavailable.push(`Component ${index + 1}: invalid shape`); return; }
        const sources = ['internalProduct', 'childVariation', 'childProduct', 'supplierItem'].filter(key => item[key] != null);
        if (sources.length !== 1 || !isRecord(item[sources[0]])) { unavailable.push(`Component ${index + 1}: ambiguous/missing source`); return; }
        const source = item[sources[0]] as Record<string, unknown>, cost = decimal(sources[0] === 'supplierItem' ? source.cost : source.cogs, 1e9), quantity = decimal(item.quantity, 1e6), waste = item.wasteFactor === undefined || item.wasteFactor === null ? 0 : decimal(item.wasteFactor, 1);
        if (cost === null || quantity === null || quantity <= 0 || waste === null || source.currency !== currency || item.unitBasis !== 'per-component-unit') { unavailable.push(`Component ${index + 1}: cost, quantity, waste ratio, currency or unit basis unavailable`); return; }
        total += cost * quantity * (1 + waste);
    });
    if (!Number.isFinite(total) || total > 1e12) unavailable.push('Total exceeds supported precision/bounds');
    return { total: unavailable.length ? null : total, currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null, complete: unavailable.length === 0, unavailable };
}
