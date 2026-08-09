import type { WholesalePriceTier } from '../../types/wholesaleCatalog';

export function requiresFinalTierRemovalConfirmation(tiers: WholesalePriceTier[], index: number): boolean {
    return tiers.length === 1 && index === 0;
}

export function inferWholesaleTierRanges(tiers: WholesalePriceTier[]): string[] {
    return tiers.map((tier, index) => tiers[index + 1]
        ? `${tier.minimumQuantity}-${tiers[index + 1].minimumQuantity - 1}`
        : `${tier.minimumQuantity}+`);
}

export function validateWholesaleTiers(tiers: WholesalePriceTier[]): string[] {
    const errors: string[] = [];
    if (tiers.length > 5) errors.push('A maximum of 5 tiers is allowed.');

    let previousQuantity = 0;
    let previousPrice: number | null = null;
    let poaSeen = false;
    const quantities = new Set<number>();

    tiers.forEach((tier, index) => {
        const row = `Tier ${index + 1}`;
        if (!Number.isInteger(tier.minimumQuantity) || tier.minimumQuantity <= 0) errors.push(`${row} minimum quantity must be a positive whole number.`);
        if (quantities.has(tier.minimumQuantity) || tier.minimumQuantity <= previousQuantity) errors.push('Minimum quantities must be unique and ascending.');
        quantities.add(tier.minimumQuantity);
        previousQuantity = tier.minimumQuantity;
        if (tier.leadTimeDays != null && (!Number.isInteger(tier.leadTimeDays) || tier.leadTimeDays < 0 || tier.leadTimeDays > 3650)) errors.push(`${row} lead time must be a whole number from 0 to 3650 days.`);

        if (tier.isPoa) {
            poaSeen = true;
            if (tier.unitPrice !== null && tier.unitPrice !== '') errors.push(`${row} cannot have both a price and POA.`);
            return;
        }
        if (poaSeen) errors.push('POA tiers must follow all numeric tiers.');
        const price = Number(tier.unitPrice);
        if (!tier.unitPrice || !Number.isFinite(price) || price <= 0) {
            errors.push(`${row} price must be positive or marked POA.`);
        } else if (previousPrice !== null && price > previousPrice) {
            errors.push('Numeric prices must be non-increasing.');
        }
        if (Number.isFinite(price) && price > 0) previousPrice = price;
    });

    return [...new Set(errors)];
}
