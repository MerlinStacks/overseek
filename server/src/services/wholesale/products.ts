import z from 'zod';
import { prisma } from '../../utils/prisma';
import { deriveWooCategory, getProductReadiness, inferTierRanges, normalizeNotes, normalizePrice, productProfileSchema, stableHash } from './validation';
import { markApprovedGenerationsStale } from './staleness';
import { reconcileEligibility } from './eligibility';

export class WholesaleNotFoundError extends Error {}
export class WholesaleValidationError extends Error {
    constructor(message: string, public details?: unknown) { super(message); }
}

function serializeProfile(profile: any, product?: any) {
    const tiers = (profile?.priceTiers || []).map((tier: any) => ({
        ...tier,
        unitPrice: tier.unitPrice == null ? null : tier.unitPrice.toString(),
        rangeLabel: '',
    }));
    const ranges = inferTierRanges(tiers);
    tiers.forEach((tier: any, index: number) => { tier.rangeLabel = ranges[index].rangeLabel; });
    return {
        ...profile,
        product: product ? { id: product.id, wooId: product.wooId, name: product.name, sku: product.sku, mainImage: product.mainImage } : undefined,
        priceTiers: tiers,
    };
}

const productInclude = {
    variations: { select: { stockStatus: true } },
    wholesaleProfile: { include: { priceTiers: { orderBy: { sortOrder: 'asc' } } } },
};

export class WholesaleProductService {
    static auditSnapshot(profile: any) {
        if (!profile) return null;
        return {
            priceTiers: (profile.priceTiers || []).map((tier: any) => ({
                minimumQuantity: tier.minimumQuantity,
                unitPrice: tier.unitPrice == null ? null : String(tier.unitPrice),
                isPoa: !!tier.isPoa,
                sortOrder: tier.sortOrder,
            })),
            priceTaxBasis: profile.priceTaxBasis,
            personalisationTypes: [...(profile.personalisationTypes || [])].map(String).sort(),
            notesHash: stableHash(normalizeNotes(profile.notesDocument)),
        };
    }

    static async history(accountId: string, productId: string, page: number, limit: number) {
        const product = await (prisma as any).wooProduct.findFirst({ where: { id: productId, accountId }, select: { id: true } });
        if (!product) throw new WholesaleNotFoundError('Product not found');
        const where = { accountId, action: 'WHOLESALE_PRODUCT_UPDATED', resource: 'WHOLESALE_PRODUCT', resourceId: productId };
        const [events, total] = await Promise.all([
            (prisma as any).auditLog.findMany({ where, include: { user: { select: { fullName: true, email: true, avatarUrl: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
            (prisma as any).auditLog.count({ where }),
        ]);
        return { events, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    static async list(accountId: string, options: { page: number; limit: number; search?: string; eligibleOnly: boolean }) {
        await reconcileEligibility(accountId);
        const where: any = { accountId };
        if (options.search) {
            where.OR = [
                { name: { contains: options.search, mode: 'insensitive' } },
                { sku: { contains: options.search, mode: 'insensitive' } },
            ];
        }
        const [products, suspendedPlacements] = await Promise.all([
            (prisma as any).wooProduct.findMany({ where, include: productInclude, orderBy: { name: 'asc' } }),
            (prisma as any).wholesaleCatalogProduct.findMany({ where: { accountId, isSuspended: true }, select: { productId: true } }),
        ]);
        const suspendedIds = new Set(suspendedPlacements.map((placement: any) => placement.productId));
        const summarized = products.map((product: any) => ({
            id: product.id,
            wooId: product.wooId,
            name: product.name,
            sku: product.sku,
            status: product.status,
            stockStatus: product.stockStatus,
            imageUrl: product.wholesaleProfile?.imageUrl || product.mainImage,
            categoryLabel: deriveWooCategory(product.rawData).label,
            rrp: String(product.rawData?.regular_price || product.price || '') || null,
            readiness: getProductReadiness(product),
            profile: product.wholesaleProfile ? serializeProfile(product.wholesaleProfile) : null,
        })).filter((product: any) => !options.eligibleOnly || (product.readiness.eligible && !suspendedIds.has(product.id)));
        const total = summarized.length;
        const start = (options.page - 1) * options.limit;
        return { products: summarized.slice(start, start + options.limit), total, page: options.page, limit: options.limit };
    }

    static async get(accountId: string, productId: string) {
        const product = await (prisma as any).wooProduct.findFirst({ where: { id: productId, accountId }, include: productInclude });
        if (!product) throw new WholesaleNotFoundError('Product not found');
        return {
            product: { id: product.id, wooId: product.wooId, name: product.name, sku: product.sku, mainImage: product.mainImage },
            profile: product.wholesaleProfile ? serializeProfile(product.wholesaleProfile) : null,
            readiness: getProductReadiness(product),
        };
    }

    static async save(accountId: string, productId: string, input: z.infer<typeof productProfileSchema>) {
        const product = await (prisma as any).wooProduct.findFirst({ where: { id: productId, accountId }, select: { id: true } });
        if (!product) throw new WholesaleNotFoundError('Product not found');
        const existing = await (prisma as any).wholesaleProductProfile.findFirst({ where: { productId, accountId }, select: { id: true, priceSetVersion: true } });
        const profile = await (prisma as any).$transaction(async (tx: any) => {
            const saved = existing
                ? await tx.wholesaleProductProfile.update({
                    where: { id: existing.id },
                    data: {
                        notesDocument: normalizeNotes(input.notesDocument),
                        personalisationTypes: input.personalisationTypes,
                        imageUrl: input.imageUrl || null,
                        priceTaxBasis: input.priceTaxBasis,
                        priceSetVersion: existing.priceSetVersion + 1,
                    },
                })
                : await tx.wholesaleProductProfile.create({
                    data: {
                        accountId,
                        productId,
                        notesDocument: normalizeNotes(input.notesDocument),
                        personalisationTypes: input.personalisationTypes,
                        imageUrl: input.imageUrl || null,
                        priceTaxBasis: input.priceTaxBasis,
                    },
                });
            await tx.wholesalePriceTier.deleteMany({ where: { accountId, profileId: saved.id } });
            if (input.priceTiers.length) {
                await tx.wholesalePriceTier.createMany({ data: input.priceTiers.map((tier, sortOrder) => ({
                    accountId,
                    profileId: saved.id,
                    minimumQuantity: tier.minimumQuantity,
                    unitPrice: tier.isPoa ? null : normalizePrice(tier.unitPrice!),
                    isPoa: tier.isPoa,
                    sortOrder,
                })) });
                const eligibleProduct = await tx.wooProduct.findFirst({
                    where: { id: productId, accountId },
                    include: {
                        variations: { select: { stockStatus: true } },
                        wholesaleProfile: { include: { priceTiers: { select: { id: true } } } },
                    },
                });
                if (eligibleProduct && getProductReadiness(eligibleProduct).eligible) {
                    await tx.wholesaleCatalogProduct.updateMany({
                        where: { accountId, productId, isSuspended: true, suspensionReason: 'NO_PRICE_TIERS', restoreAllowed: true },
                        data: { isSuspended: false, suspensionReason: null, suspendedAt: null },
                    });
                }
            } else {
                await tx.wholesaleCatalogProduct.updateMany({
                    where: { accountId, productId },
                    data: { isSuspended: true, suspensionReason: 'NO_PRICE_TIERS', suspendedAt: new Date() },
                });
            }
            const placements = await tx.wholesaleCatalogProduct.findMany({ where: { accountId, productId }, select: { catalogId: true } });
            for (const catalogId of new Set(placements.map((placement: any) => placement.catalogId))) {
                await markApprovedGenerationsStale(accountId, { code: 'PRODUCT_PROFILE_CHANGED', resourceType: 'WHOLESALE_PRODUCT', resourceId: productId }, String(catalogId), tx);
            }
            return tx.wholesaleProductProfile.findFirst({ where: { id: saved.id, accountId }, include: { priceTiers: { orderBy: { sortOrder: 'asc' } } } });
        });
        return serializeProfile(profile);
    }
}
