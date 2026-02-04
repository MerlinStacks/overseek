/**
 * Variant Types
 * 
 * Type definitions for product variations.
 */

export interface ProductVariant {
    id: number;
    sku: string;
    price: string;
    salePrice?: string;
    cogs?: string;
    binLocation?: string;
    stockStatus?: string;
    stockQuantity?: number;
    manageStock?: boolean;
    backorders?: 'no' | 'notify' | 'yes';
    weight?: string;
    dimensions?: {
        length?: string;
        width?: string;
        height?: string;
    };
    image?: { src: string } | null;
    images?: any[];
    attributes: any[];
    isGoldPriceApplied?: boolean;
    goldPriceType?: string | null;
}

/**
 * Get variation image from either image object or images array.
 */
export function getVariantImage(v: ProductVariant): string | null {
    if (v.image?.src) return v.image.src;
    if (v.images && v.images.length > 0) {
        return v.images[0]?.src || v.images[0];
    }
    return null;
}
