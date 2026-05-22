/**
 * BOM (Bill of Materials) utility functions.
 * Shared logic for calculating BOM costs across components.
 */

interface BOMItemCostData {
    internalProduct?: { cogs?: string | number | null };
    childVariation?: { cogs?: string | number | null };
    childProduct?: { cogs?: string | number | null };
    supplierItem?: { cost?: string | number | null };
    quantity: number | string;
    wasteFactor?: number | string | null;
}

function toFiniteNumber(value: string | number | null | undefined, fallback = 0): number {
    const number = Number(value ?? fallback);
    return Number.isFinite(number) ? number : fallback;
}

/**
 * Calculates the total cost of a single BOM item including waste factor.
 * Priority order: Internal Product > Variant > Product > Supplier Item
 */
function calculateBomItemCost(item: BOMItemCostData): number {
    let unitCost = 0;

    if (item.internalProduct?.cogs != null) {
        unitCost = toFiniteNumber(item.internalProduct.cogs);
    } else if (item.childVariation?.cogs != null) {
        unitCost = toFiniteNumber(item.childVariation.cogs);
    } else if (item.childProduct?.cogs != null) {
        unitCost = toFiniteNumber(item.childProduct.cogs);
    } else if (item.supplierItem?.cost != null) {
        unitCost = toFiniteNumber(item.supplierItem.cost);
    }

    const quantity = toFiniteNumber(item.quantity);
    const waste = Math.max(0, toFiniteNumber(item.wasteFactor));

    return unitCost * quantity * (1 + waste);
}

/**
 * Calculates the total cost of all BOM items.
 */
export function calculateTotalBomCost(items: BOMItemCostData[]): number {
    return items.reduce((sum, item) => sum + calculateBomItemCost(item), 0);
}
