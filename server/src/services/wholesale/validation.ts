import { createHash } from 'crypto';
import z from 'zod';

export const taxBasisSchema = z.enum(['INCLUSIVE', 'EXCLUSIVE']);
export const badgeSchema = z.enum(['ENGRAVE', 'SUBLIMATE', 'UV', 'DTF', 'EMBROIDERY']);

const tierBaseSchema = z.object({
    minimumQuantity: z.number().int().positive(),
    unitPrice: z.union([
        z.number().positive().finite(),
        z.string().regex(/^\d+(?:\.\d{1,4})?$/).refine(value => Number.isFinite(Number(value)) && Number(value) > 0),
    ]).nullable().optional(),
    isPoa: z.boolean().default(false),
    leadTimeDays: z.number().int().min(0).max(3650).nullable().optional(),
}).strict();

export const priceTiersSchema = z.array(tierBaseSchema).max(5).superRefine((tiers, ctx) => {
    let previousQuantity = 0;
    let previousPrice: number | null = null;
    let poaSeen = false;
    const quantities = new Set<number>();

    tiers.forEach((tier, index) => {
        const numericPrice = tier.unitPrice == null ? null : Number(tier.unitPrice);
        if (quantities.has(tier.minimumQuantity) || tier.minimumQuantity <= previousQuantity) {
            ctx.addIssue({ code: 'custom', path: [index, 'minimumQuantity'], message: 'Minimum quantities must be unique and ascending' });
        }
        quantities.add(tier.minimumQuantity);
        previousQuantity = tier.minimumQuantity;

        if (tier.isPoa === (numericPrice !== null)) {
            ctx.addIssue({ code: 'custom', path: [index], message: 'Each tier must have exactly one of a positive unit price or POA' });
        }
        if (poaSeen && !tier.isPoa) {
            ctx.addIssue({ code: 'custom', path: [index], message: 'POA tiers must follow all numeric tiers' });
        }
        if (tier.isPoa) {
            poaSeen = true;
        } else if (numericPrice !== null) {
            if (previousPrice !== null && numericPrice > previousPrice) {
                ctx.addIssue({ code: 'custom', path: [index, 'unitPrice'], message: 'Numeric prices must be non-increasing' });
            }
            previousPrice = numericPrice;
        }
    });
});

const simpleValueSchema = z.union([
    z.string().max(1000),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string().max(250), z.number().finite(), z.boolean(), z.null()])).max(20),
]);

export const notesDocumentSchema = z.union([
    z.string().max(1000),
    z.record(z.string().max(60), simpleValueSchema),
]).nullable().optional().superRefine((value, ctx) => {
    if (value != null && JSON.stringify(value).length > 1000) {
        ctx.addIssue({ code: 'custom', message: 'Notes must not exceed 1000 characters' });
    }
});

export const productProfileSchema = z.object({
    notesDocument: notesDocumentSchema,
    personalisationTypes: z.array(badgeSchema).max(5).default([]),
    imageUrl: z.url().max(2048).nullable().optional(),
    priceTaxBasis: taxBasisSchema,
    priceTiers: priceTiersSchema,
}).strict();

export const productSettingsSchema = productProfileSchema.extend({
    baseTurnaroundDays: z.number().int().min(0).max(3650).nullable().optional(),
}).strict();

export type PriceTierInput = z.infer<typeof priceTiersSchema>[number];

export function normalizeNotes(value: z.infer<typeof notesDocumentSchema>): unknown {
    if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
    if (!value) return null;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key.trim(),
        typeof item === 'string' ? item.trim().replace(/\s+/g, ' ') : item,
    ]));
}

export function normalizePrice(value: number | string): string {
    return Number(value).toFixed(4);
}

export function inferTierRanges(tiers: Array<{ minimumQuantity: number }>): Array<{ minimumQuantity: number; rangeLabel: string }> {
    return tiers.map((tier, index) => ({
        minimumQuantity: tier.minimumQuantity,
        rangeLabel: tiers[index + 1]
            ? `${tier.minimumQuantity}-${tiers[index + 1].minimumQuantity - 1}`
            : `${tier.minimumQuantity}+`,
    }));
}

export function stableHash(value: unknown): string {
    const sort = (item: any): any => {
        if (Array.isArray(item)) return item.map(sort);
        if (item && typeof item === 'object') {
            return Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])]));
        }
        return item;
    };
    return createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

export interface EligibilityProduct {
    status?: string | null;
    sku?: string | null;
    stockStatus?: string | null;
    mainImage?: string | null;
    rawData?: { images?: Array<{ src?: string | null }> } | null;
    variations?: Array<{ stockStatus?: string | null }>;
    wholesaleProfile?: { imageUrl?: string | null; priceTiers?: unknown[] } | null;
}

export function getProductReadiness(product: EligibilityProduct) {
    const published = product.status === 'publish';
    const inStock = product.stockStatus === 'instock'
        || !!product.variations?.some(variation => variation.stockStatus === 'instock');
    const hasSku = !!product.sku?.trim();
    const hasImage = !!(product.wholesaleProfile?.imageUrl || product.rawData?.images?.[0]?.src || product.mainImage)?.trim();
    const hasPriceTiers = (product.wholesaleProfile?.priceTiers?.length || 0) > 0;
    return {
        eligible: published && inStock && hasSku && hasImage && hasPriceTiers,
        published,
        inStock,
        hasSku,
        hasImage,
        hasPriceTiers,
    };
}

export function deriveWooCategory(rawData: unknown): { key: string | null; label: string | null; sortOrder: number } {
    const categories = rawData && typeof rawData === 'object' && Array.isArray((rawData as any).categories)
        ? (rawData as any).categories
        : [];
    const category = categories.find((item: unknown) => item && typeof item === 'object');
    if (!category) return { key: null, label: null, sortOrder: 0 };
    const label = typeof category.name === 'string' ? category.name.trim() : '';
    const rawKey = typeof category.slug === 'string' ? category.slug : category.id;
    const sortOrder = Number.isInteger(category.menu_order) && category.menu_order >= 0 ? category.menu_order : 0;
    return { key: rawKey == null ? label || null : String(rawKey), label: label || null, sortOrder };
}
