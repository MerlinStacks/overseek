import type { Prisma, WooProduct } from '@prisma/client';
import { catalogueTransaction } from './catalogueTransaction';
import { deactivateWooVariationRecipes, reconcileWooVariations } from './reconcileWooVariations';
import { parseWooVariations, WooVariationValidationFailure } from './sync/wooSchemas';

export type CatalogueObservationResult =
    | { accepted: true; product: WooProduct; variationsSynced: number }
    | { accepted: false; reason: 'stale' | 'incomplete_product' | 'incomplete_variations' | 'quarantined_variations' | 'parent_mismatch'; failures?: WooVariationValidationFailure[] };

export function needsWooVariationListing(type: unknown, raw: unknown): boolean {
    const ids = (raw as { variations?: unknown })?.variations;
    return type !== 'simple' && ((typeof type === 'string' && type.includes('variable')) || (Array.isArray(ids) && ids.length > 0));
}

/** Fetch outside this function. Validation is completed before opening a transaction.
 * Parent source, children, delivery membership, dirty targets and the observation
 * fence commit together. A rejected observation is NOT a persisted product.
 *
 * A quarantined/incomplete parent's entire snapshot is deferred, including valid
 * siblings: applying only their stock-owner fields could mix incompatible topology.
 */
export async function persistWooProduct(type: unknown, args: Prisma.WooProductUpsertArgs,
    observedBefore = new Date(), rawVariations?: unknown[]): Promise<CatalogueObservationResult> {
    const identity = args.where.accountId_wooId;
    if (!identity) throw new Error('Catalogue persistence requires account context');
    const { accountId, wooId } = identity;
    if (!Number.isFinite(observedBefore.getTime())) throw new Error('Invalid catalogue observation time');
    if (typeof type !== 'string' || !type) return { accepted: false, reason: 'incomplete_product' };
    if (type !== 'simple' && !type.includes('variable') && rawVariations !== undefined) {
        return { accepted: false, reason: 'incomplete_product' };
    }
    const raw = (args.update.rawData ?? args.create.rawData) as { variations?: unknown };
    const trash = args.update.status === 'trash' || args.create.status === 'trash';
    const needsListing = !trash && needsWooVariationListing(type, raw);
    if (needsListing && rawVariations === undefined) return { accepted: false, reason: 'incomplete_variations' };
    const parsed = parseWooVariations(rawVariations ?? [], wooId);
    if (parsed.failures.length) return { accepted: false, reason: 'quarantined_variations', failures: parsed.failures };
    const ids = parsed.variations.map(v => v.id);
    if (new Set(ids).size !== ids.length || (type === 'simple' && ids.length)) return { accepted: false, reason: 'parent_mismatch' };
    if (needsListing && raw?.variations !== undefined &&
        (!Array.isArray(raw.variations) || raw.variations.length !== ids.length || !raw.variations.every(id => ids.includes(id)))) {
        return { accepted: false, reason: 'parent_mismatch' };
    }

    return catalogueTransaction<CatalogueObservationResult>(accountId, async tx => {
        const current = await tx.wooProduct.findUnique({ where: args.where });
        // Equal timestamps are conservatively rejected too: two observations in
        // the same millisecond must not overwrite each other's committed source.
        if (current?.deliveryMembershipObservedAt && current.deliveryMembershipObservedAt >= observedBefore) {
            return { accepted: false, reason: 'stale' };
        }
        // A parent-only/missing-type payload cannot replace an existing variable
        // topology. A complete listing or explicit simple conversion is required.
        if (!trash && type !== 'simple' && rawVariations === undefined &&
            needsWooVariationListing((current?.rawData as any)?.type, current?.rawData)) {
            return { accepted: false, reason: 'incomplete_variations' };
        }
        // The transaction must inspect the actual persisted status, even if an
        // internal caller supplied a narrower return projection.
        const product = await tx.wooProduct.upsert({ where: args.where,
            update: { ...args.update, deliveryMembershipObservedAt: observedBefore },
            create: { ...args.create, deliveryMembershipObservedAt: observedBefore },
        });
        if (!trash && product.status !== 'trash') {
            for (const v of parsed.variations) {
                // Ordinary accepted Woo source imports only. Never import COGS,
                // supplier overrides, production settings or other local metadata.
                const fields = {
                    sku: v.sku || null, price: v.price ? parseFloat(v.price) : null,
                    salePrice: v.sale_price ? parseFloat(v.sale_price) : null,
                    stockStatus: v.stock_status, stockQuantity: v.stock_quantity ?? null,
                    manageStock: v.manage_stock === true,
                    weight: v.weight ? parseFloat(v.weight) : null,
                    length: v.dimensions?.length ? parseFloat(v.dimensions.length) : null,
                    width: v.dimensions?.width ? parseFloat(v.dimensions.width) : null,
                    height: v.dimensions?.height ? parseFloat(v.dimensions.height) : null,
                    images: (v.image ? [v.image] : []) as Prisma.InputJsonValue, rawData: v as Prisma.InputJsonObject,
                };
                await tx.productVariation.upsert({
                    where: { productId_wooId: { productId: product.id, wooId: v.id } },
                    update: fields, create: { ...fields, productId: product.id, wooId: v.id },
                });
            }
            if (type === 'simple') await deactivateWooVariationRecipes(tx, accountId, product.id);
            if (type === 'simple' || (typeof type === 'string' && type.includes('variable'))) {
                await reconcileWooVariations(tx, accountId, product.id, wooId, ids, observedBefore);
            }
        }
        return { accepted: true, product, variationsSynced: parsed.variations.length };
    });
}
