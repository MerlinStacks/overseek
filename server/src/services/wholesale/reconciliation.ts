import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';
import { getProductReadiness } from './validation';

function firstWooCategory(rawData: any) {
    const category = Array.isArray(rawData?.categories) ? rawData.categories.find((item: any) => item && typeof item === 'object') : null;
    const label = String(category?.name || 'Products').trim() || 'Products';
    return { key: String(category?.slug ?? category?.id ?? label), label };
}

function currentVariantSignature(product: any) {
    return (product.variations || []).map((variation: any) => {
        const raw = variation.rawData && typeof variation.rawData === 'object' ? variation.rawData : {};
        const imageUrl = String(raw.image?.src || variation.images?.[0]?.src || variation.images?.[0] || '');
        const label = [
            (raw.attributes || []).map((item: any) => `${item?.name || 'Option'}: ${item?.option || ''}`).join(', '),
            variation.sku ? `SKU ${variation.sku}` : '',
        ].filter(Boolean).join(' | ');
        return { stockStatus: variation.stockStatus, imageUrl, label };
    }).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function wholesaleDisplayChanged(snapshotProduct: any, snapshotCategory: any, product: any) {
    if (!snapshotProduct) return true;
    const category = firstWooCategory(product.rawData);
    const currentImage = product.wholesaleProfile?.imageUrl || product.rawData?.images?.[0]?.src || product.mainImage || null;
    const snapshotVariants = (snapshotProduct.variantGroups || []).flatMap((group: any) =>
        (group.labels || []).map((label: string) => ({ stockStatus: 'instock', imageUrl: group.imageUrl, label })),
    ).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return String(snapshotProduct.name || '') !== String(product.name || '')
        || String(snapshotProduct.sku || '') !== String(product.sku || '')
        || String(snapshotProduct.sourceRrp ?? '') !== String(product.rawData?.regular_price ?? '')
        || String(snapshotProduct.imageUrl || '') !== String(currentImage || '')
        || String(snapshotCategory?.key || '') !== category.key
        || String(snapshotCategory?.label || '') !== category.label
        || String(snapshotProduct.stockFingerprint || '') !== `${product.stockStatus || ''}|${(product.variations || []).map((item: any) => item.stockStatus || '').sort().join(',')}`
        || JSON.stringify(snapshotVariants) !== JSON.stringify(currentVariantSignature(product).filter((item: any) => item.stockStatus === 'instock' && item.imageUrl));
}

export async function reconcileWholesaleProducts(accountId: string, productIds: string[], options: { deleted?: boolean } = {}) {
    const ids = [...new Set(productIds)].filter(Boolean);
    if (!ids.length) return { placements: 0, staleGenerations: 0 };
    return (prisma as any).$transaction(async (tx: any) => {
        const placements = await tx.wholesaleCatalogProduct.findMany({
            where: { accountId, productId: { in: ids } },
            include: { catalog: { select: { status: true } } },
        });
        const catalogIds = [...new Set(placements.map((item: any) => item.catalogId))] as string[];
        const products = options.deleted ? [] : await tx.wooProduct.findMany({
            where: { accountId, id: { in: ids } },
            include: { variations: { select: { sku: true, stockStatus: true, images: true, rawData: true } }, wholesaleProfile: { include: { priceTiers: { select: { id: true } } } } },
        });
        const productMap = new Map(products.map((product: any) => [product.id, product]));
        let changedPlacements = 0;
        for (const placement of placements) {
            const product: any = productMap.get(placement.productId);
            if (!product) continue;
            const readiness = getProductReadiness(product);
            const automaticReason = !readiness.inStock ? 'OUT_OF_STOCK' : !readiness.hasPriceTiers ? 'NO_PRICE_TIERS' : null;
            const restore = !automaticReason && placement.isSuspended && placement.restoreAllowed !== false
                && ['OUT_OF_STOCK', 'NO_PRICE_TIERS'].includes(placement.suspensionReason);
            const category = firstWooCategory(product.rawData);
            const data: any = {};
            if (placement.catalog.status === 'DRAFT' && (placement.categoryKey !== category.key || placement.categoryLabel !== category.label)) {
                data.categoryKey = category.key; data.categoryLabel = category.label;
            }
            if (automaticReason && (!placement.isSuspended || placement.suspensionReason !== automaticReason)) {
                Object.assign(data, { isSuspended: true, suspensionReason: automaticReason, suspendedAt: new Date() });
            } else if (restore) Object.assign(data, { isSuspended: false, suspensionReason: null, suspendedAt: null });
            if (Object.keys(data).length) { await tx.wholesaleCatalogProduct.update({ where: { id: placement.id }, data }); changedPlacements++; }
        }

        const generations = catalogIds.length ? await tx.wholesaleCatalogGeneration.findMany({
            where: { accountId, catalogId: { in: catalogIds }, status: 'APPROVED', staleAt: null },
            select: { id: true, inputSnapshot: true, staleReasons: true },
        }) : [];
        let staleGenerations = 0;
        for (const generation of generations) {
            const snapshot: any = generation.inputSnapshot;
            const changed = options.deleted || ids.some(productId => {
                const product: any = productMap.get(productId);
                if (!product) return false;
                const category = (snapshot?.categories || []).find((item: any) => item.products?.some((candidate: any) => candidate.id === productId));
                const oldProduct = category?.products?.find((candidate: any) => candidate.id === productId);
                return wholesaleDisplayChanged(oldProduct, category, product);
            });
            if (!changed) continue;
            const changedAt = new Date();
            const previous = Array.isArray(generation.staleReasons) ? generation.staleReasons : [];
            await tx.wholesaleCatalogGeneration.update({ where: { id: generation.id }, data: {
                staleAt: changedAt,
                staleReasons: [...previous, { code: 'WOO_PRODUCT_CHANGED', resourceType: 'WOO_PRODUCT', changedAt: changedAt.toISOString() }],
            } });
            staleGenerations++;
        }
        return { placements: changedPlacements, staleGenerations };
    });
}

export async function reconcileWholesaleProductsBestEffort(accountId: string, productIds: string[], options: { deleted?: boolean } = {}) {
    try { return await reconcileWholesaleProducts(accountId, productIds, options); }
    catch (error) {
        Logger.warn('[WholesaleReconciliation] Woo sync reconciliation failed', { accountId, productCount: productIds.length, error });
        return null;
    }
}
