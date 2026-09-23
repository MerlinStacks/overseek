import { prisma } from '../utils/prisma';
import { invalidateCache } from '../utils/cache';
import { IndexingService } from './search/IndexingService';
import { reconcileWholesaleProductsBestEffort } from './wholesale/reconciliation';

/** Only Woo's product-specific error authorizes permanent reconciliation. */
export function isWooProductNotFound(error: unknown): boolean {
    const response = (error as any)?.response;
    return response?.status === 404 && response?.data?.code === 'woocommerce_rest_product_invalid_id';
}

/** Trash is reversible: do not touch local costs, variants, recipes or references. */
export async function trashWooProduct(accountId: string, wooId: number) {
    const product = await prisma.wooProduct.findUnique({ where: { accountId_wooId: { accountId, wooId } } });
    if (product) {
        await prisma.wooProduct.update({
            where: { id: product.id, accountId },
            data: { status: 'trash', rawData: { ...(product.rawData as object || {}), status: 'trash' } }
        });
    }
    await invalidateCache('products', `products:list:${accountId}:`);
    // Always retry removal, even when there is no local row.
    await IndexingService.deleteProduct(accountId, wooId);
    if (product) await reconcileWholesaleProductsBestEffort(accountId, [product.id], { deleted: true });
    return product;
}

export async function permanentlyDeleteWooProduct(accountId: string, wooId: number) {
    // Search first: a failed sync remains discoverable in the DB on the next run.
    // This is idempotent and deliberately independent of local row existence.
    await IndexingService.deleteProduct(accountId, wooId);
    const local = await prisma.wooProduct.findUnique({ where: { accountId_wooId: { accountId, wooId } }, select: { id: true } });
    if (local) await reconcileWholesaleProductsBestEffort(accountId, [local.id], { deleted: true });
    const count = await prisma.$transaction(async tx => {
        const product = await tx.wooProduct.findUnique({ where: { accountId_wooId: { accountId, wooId } }, select: { id: true } });
        if (!product) return 0;
        // Detach both compound-FK columns before cascades can turn a variant
        // reference into an active parent reference. Own recipes may cascade.
        await tx.bOMItem.updateMany({
            where: { childProductId: product.id },
            data: { isActive: false, deactivatedReason: 'PRODUCT_DELETED_IN_WOO', childProductId: null, childVariationId: null }
        });
        const { count } = await tx.wooProduct.deleteMany({ where: { id: product.id, accountId, wooId } });
        return count;
    });
    await invalidateCache('products', `products:list:${accountId}:`);
    return count;
}
