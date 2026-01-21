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

/**
 * Calculates the total cost of a single BOM item including waste factor.
 * Priority order: Internal Product > Variant > Product > Supplier Item
 */
export function calculateBomItemCost(item: BOMItemCostData): number {
    let unitCost = 0;

    if (item.internalProduct?.cogs) {
        unitCost = Number(item.internalProduct.cogs);
    } else if (item.childVariation?.cogs) {
        unitCost = Number(item.childVariation.cogs);
    } else if (item.childProduct?.cogs) {
        unitCost = Number(item.childProduct.cogs);
    } else if (item.supplierItem?.cost) {
        unitCost = Number(item.supplierItem.cost);
    }

    const quantity = Number(item.quantity);
    const waste = Number(item.wasteFactor || 0);

    return unitCost * quantity * (1 + waste);
}

/**
 * Calculates the total cost of all BOM items.
 */
export function calculateTotalBomCost(items: BOMItemCostData[]): number {
    return items.reduce((sum, item) => sum + calculateBomItemCost(item), 0);
}
