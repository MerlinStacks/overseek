import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

/** Persist an authoritative Woo snapshot and retire variations atomically.
 * Missing/custom types are not evidence that variations have been removed.
 */
export function persistWooProduct(type: unknown, args: Prisma.WooProductUpsertArgs) {
    if (type !== 'simple' || args.update.status === 'trash' || args.create.status === 'trash') return prisma.wooProduct.upsert(args);

    return prisma.$transaction(async tx => {
        const product = await tx.wooProduct.upsert(args);

        // The optional compound FK defaults to SetNull for BOTH columns. Explicitly
        // detach and deactivate first so a deleted variant cannot become an active
        // parent-product component. Retain the item for auditing, as the existing
        // missing-Woo-variation flow does. Parent-only components are unaffected.
        await tx.bOMItem.updateMany({
            where: { childProductId: product.id, childVariationId: { not: null } },
            data: {
                isActive: false,
                deactivatedReason: 'VARIATION_DELETED_IN_WOO',
                childProductId: null,
                childVariationId: null
            }
        });
        // BOM.variationId is a Woo ID, not a FK. Preserve locally-owned recipe
        // headers/items for auditing, but stop consuming obsolete variant recipes.
        // Never promote them to variationId=0 or deactivate parent recipe items
        // unless they reference a removed variant (handled above).
        await tx.bOMItem.updateMany({
            where: {
                bom: { productId: product.id, variationId: { not: 0 } },
                // Prisma's `not` excludes SQL NULL, which also needs repairing.
                OR: [
                    { isActive: true },
                    { deactivatedReason: null },
                    { deactivatedReason: { not: 'VARIATION_DELETED_IN_WOO' } }
                ]
            },
            data: { isActive: false, deactivatedReason: 'VARIATION_DELETED_IN_WOO' }
        });
        await tx.productVariation.deleteMany({ where: { productId: product.id } });
        return product;
    });
}
