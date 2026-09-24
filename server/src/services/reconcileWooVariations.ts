import type { Prisma } from '@prisma/client';
import { dirtyInboundProducts } from './deliveryEstimates/intents';
import { activeProductWhere } from './productStatus';

/** Disable obsolete consumption without detaching audit references. NULL reasons
 * need an explicit branch: SQL `not` does not match NULL. */
export async function deactivateWooVariationRecipes(tx: Prisma.TransactionClient, accountId: string,
    productId: string, missingIds?: number[]) {
    const changed = { OR: [{ isActive: true }, { deactivatedReason: null }, { deactivatedReason: { not: 'VARIATION_DELETED_IN_WOO' } }] };
    const data = { isActive: false, deactivatedReason: 'VARIATION_DELETED_IN_WOO' };
    const component = await tx.bOMItem.updateMany({ where: {
        childProductId: productId, childProduct: { accountId },
        childVariationId: missingIds ? { in: missingIds } : { not: null }, ...changed,
    }, data });
    const recipe = await tx.bOMItem.updateMany({ where: {
        bom: { productId, product: { accountId }, variationId: missingIds ? { in: missingIds } : { not: 0 } }, ...changed,
    }, data });
    return component.count + recipe.count;
}

/** Production callers use this ONLY inside persistWooProduct's complete source
 * transaction, never as a second persistence phase. Caller holds the account lock.
 * Only a complete, validated Woo listing (or an
 * explicit simple snapshot) may supply these IDs. Never use updatedAt as membership:
 * unrelated local edits can touch an absent row during the sync.
 *
 * Membership is separate from history: no variant row, reference or stock field
 * is deleted or overwritten. The observation fence prevents older full listings
 * from undoing a newer confirmed conversion/restoration after lock waits/retries.
 */
export async function reconcileWooVariations(tx: Prisma.TransactionClient, accountId: string,
    productId: string, wooId: number, presentIds: number[], observedBefore = new Date()) {
    const fenced = await tx.wooProduct.updateMany({
        where: { id: productId, accountId, ...activeProductWhere, AND: [{ OR: [
            { deliveryMembershipObservedAt: null }, { deliveryMembershipObservedAt: { lte: observedBefore } },
        ] }] }, data: { deliveryMembershipObservedAt: observedBefore },
    });
    if (!fenced.count) return 0;
    const absent = await tx.productVariation.updateMany({ where: {
        productId, product: { accountId }, wooId: { notIn: presentIds }, deliveryActive: true,
    }, data: { deliveryActive: false } });
    const restored = await tx.productVariation.updateMany({ where: {
        productId, product: { accountId }, wooId: { in: presentIds }, deliveryActive: false,
    }, data: { deliveryActive: true } });
    // Include previously inactive rows so repeated authoritative snapshots can
    // repair an obsolete recipe without detaching references or promoting it.
    const inactive = await tx.productVariation.findMany({ where: { productId, product: { accountId }, deliveryActive: false }, select: { wooId: true } });
    if (inactive.length) await deactivateWooVariationRecipes(tx, accountId, productId, inactive.map(v => v.wooId));
    const changed = absent.count + restored.count;
    if (changed) await dirtyInboundProducts(tx, accountId, [wooId]);
    return changed;
}
