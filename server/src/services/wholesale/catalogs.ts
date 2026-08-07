import z from 'zod';
import { prisma } from '../../utils/prisma';
import { deriveWooCategory, getProductReadiness } from './validation';
import { WholesaleNotFoundError, WholesaleValidationError } from './products';
import { markApprovedGenerationsStale } from './staleness';
import { reconcileEligibility } from './eligibility';

export class WholesaleConflictError extends Error {}

const boundedJsonObject = z.record(z.string().max(80), z.union([
    z.string().max(3000), z.number().finite(), z.boolean(), z.null(),
    z.array(z.string().max(1000)).max(30),
])).refine(value => JSON.stringify(value).length <= 10000);
const brandingOverridesSchema = z.object({
    logoUrl: z.url().max(2048).nullable().optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    headingFont: z.string().trim().max(100).nullable().optional(),
    bodyFont: z.string().trim().max(100).nullable().optional(),
    businessDetails: z.record(z.string().max(80), z.union([z.string().trim().max(1000), z.number().finite(), z.boolean(), z.null()])).optional(),
}).strict().refine(value => JSON.stringify(value).length <= 10000);

export const catalogInputSchema = z.object({
    name: z.string().trim().min(1).max(160),
    publicTitle: z.string().trim().min(1).max(200),
    subtitle: z.string().trim().max(500).nullable().optional(),
    coverText: z.string().trim().max(10000).nullable().optional(),
    pricesIncludeTax: z.boolean(),
    supplementaryPriceNotice: z.string().trim().max(1000).nullable().optional(),
    brandingOverrides: brandingOverridesSchema,
    paymentCallout: boundedJsonObject,
    termsSections: z.array(z.object({ heading: z.string().max(160), content: z.string().max(5000) }).strict()).max(12),
    footerDetails: boundedJsonObject,
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
}).strict();

const editableKeys = [
    'name', 'publicTitle', 'subtitle', 'coverText', 'pricesIncludeTax', 'supplementaryPriceNotice',
    'brandingOverrides', 'paymentCallout', 'termsSections', 'footerDetails', 'defaultsVersion', 'status',
] as const;

function editableData(source: any) {
    return Object.fromEntries(editableKeys.map(key => [key, source[key]]));
}

export function copiedCatalogDefaults(defaults: any, input: { termsSections: unknown[]; paymentCallout: Record<string, unknown>; footerDetails: Record<string, unknown> }) {
    const approved = defaults?.approvedAt && defaults?.approvedById;
    const sections = approved && Array.isArray(defaults.termsDocument?.sections) ? defaults.termsDocument.sections : [];
    return {
        termsSections: input.termsSections.length ? input.termsSections : sections,
        paymentCallout: Object.keys(input.paymentCallout).length ? input.paymentCallout : {
            heading: 'Payment to commence production',
            content: '50% deposit or $450, whichever is greater. For orders over $10,000, a further 25% is due halfway through the quoted lead time. Bank transfer is preferred. All orders must be paid in full before dispatch.',
        },
        footerDetails: Object.keys(input.footerDetails).length ? input.footerDetails : {
            confidentialityNotice: approved ? defaults.confidentialityNotice : '',
            privacyNotice: approved ? defaults.privacyNotice : '',
        },
        defaultsVersion: approved ? defaults.version : 'unconfigured',
    };
}

export function reconcilePlacementSelection(existing: Array<{ productId: string; isSuspended: boolean }>, selectedIds: string[]) {
    const selected = new Set(selectedIds);
    return {
        deleteProductIds: existing.filter(row => !row.isSuspended && !selected.has(row.productId)).map(row => row.productId),
        preservedSuspendedIds: existing.filter(row => row.isSuspended && !selected.has(row.productId)).map(row => row.productId),
    };
}

export function buildCatalogSnapshot(catalog: any) {
    return {
        catalog: editableData(catalog),
        products: (catalog.products || []).map((placement: any) => ({
            productId: placement.productId,
            categoryKey: placement.categoryKey,
            categoryLabel: placement.categoryLabel,
            categorySortOrder: placement.categorySortOrder,
            isSuspended: placement.isSuspended,
            suspensionReason: placement.suspensionReason,
            suspendedAt: placement.suspendedAt,
            restoreAllowed: placement.restoreAllowed,
        })),
    };
}

async function saveRevision(tx: any, accountId: string, catalogId: string, userId: string) {
    const catalog = await tx.wholesaleCatalog.findFirst({
        where: { id: catalogId, accountId },
        include: { products: { orderBy: { createdAt: 'asc' } } },
    });
    const latest = await tx.wholesaleCatalogRevision.aggregate({
        where: { accountId, catalogId },
        _max: { revisionNumber: true },
    });
    await tx.wholesaleCatalogRevision.create({
        data: {
            accountId,
            catalogId,
            revisionNumber: (latest._max.revisionNumber || 0) + 1,
            snapshot: buildCatalogSnapshot(catalog),
            createdById: userId,
        },
    });
    const stale = await tx.wholesaleCatalogRevision.findMany({
        where: { accountId, catalogId },
        orderBy: { revisionNumber: 'desc' },
        skip: 25,
        select: { id: true },
    });
    if (stale.length) {
        await tx.wholesaleCatalogRevision.deleteMany({ where: { accountId, catalogId, id: { in: stale.map((item: any) => item.id) } } });
    }
}

const detailInclude = {
    products: {
        include: {
            product: {
                include: {
                    variations: { select: { stockStatus: true } },
                    wholesaleProfile: { include: { priceTiers: { orderBy: { sortOrder: 'asc' } } } },
                },
            },
        },
    },
    _count: { select: { revisions: true, generations: true } },
};

function flattenCatalog(catalog: any) {
    return {
        ...catalog,
        products: [...(catalog.products || [])]
            .sort((a: any, b: any) => a.product.name.localeCompare(b.product.name))
            .map((placement: any) => ({
                id: placement.id,
                productId: placement.productId,
                categoryKey: placement.categoryKey,
                categoryLabel: placement.categoryLabel,
                categorySortOrder: placement.categorySortOrder,
                isSuspended: placement.isSuspended,
                suspensionReason: placement.suspensionReason,
                restoreAllowed: placement.restoreAllowed,
                product: {
                    id: placement.product.id,
                    wooId: placement.product.wooId,
                    name: placement.product.name,
                    sku: placement.product.sku,
                    imageUrl: placement.product.wholesaleProfile?.imageUrl || placement.product.mainImage,
                    categoryLabel: placement.categoryLabel || deriveWooCategory(placement.product.rawData).label,
                    rrp: String(placement.product.rawData?.regular_price || placement.product.price || '') || null,
                    readiness: getProductReadiness(placement.product),
                    profile: placement.product.wholesaleProfile ? {
                        ...placement.product.wholesaleProfile,
                        priceTiers: placement.product.wholesaleProfile.priceTiers.map((tier: any) => ({
                            ...tier, unitPrice: tier.unitPrice == null ? null : tier.unitPrice.toString(),
                        })),
                    } : null,
                },
            })),
    };
}

async function eligibleProducts(tx: any, accountId: string, productIds: string[]) {
    const uniqueIds = [...new Set(productIds)];
    const products = await tx.wooProduct.findMany({
        where: { accountId, id: { in: uniqueIds } },
        include: {
            variations: { select: { stockStatus: true } },
            wholesaleProfile: { include: { priceTiers: { select: { id: true } } } },
        },
    });
    const eligible = products.filter((product: any) => getProductReadiness(product).eligible);
    if (eligible.length !== uniqueIds.length) {
        const valid = new Set(eligible.map((product: any) => product.id));
        throw new WholesaleValidationError('Catalog products must be account-owned and eligible', {
            productIds: uniqueIds.filter(id => !valid.has(id)),
        });
    }
    return eligible;
}

async function replaceProducts(tx: any, accountId: string, catalogId: string, products: any[]) {
    await tx.wholesaleCatalogProduct.deleteMany({ where: { accountId, catalogId } });
    if (!products.length) return;
    await tx.wholesaleCatalogProduct.createMany({ data: products.map(product => {
        const category = deriveWooCategory(product.rawData);
        return { accountId, catalogId, productId: product.id, categoryKey: category.key, categoryLabel: category.label, categorySortOrder: category.sortOrder };
    }) });
}

export class WholesaleCatalogService {
    static async list(accountId: string, options: { page: number; limit: number; status?: string; search?: string }) {
        const where: any = { accountId };
        if (options.status) where.status = options.status;
        if (options.search) where.name = { contains: options.search, mode: 'insensitive' };
        const [catalogs, total] = await Promise.all([
            (prisma as any).wholesaleCatalog.findMany({
                where,
                include: { _count: { select: { products: true, revisions: true, generations: true } } },
                orderBy: { updatedAt: 'desc' },
                skip: (options.page - 1) * options.limit,
                take: options.limit,
            }),
            (prisma as any).wholesaleCatalog.count({ where }),
        ]);
        return { catalogs, total, page: options.page, limit: options.limit };
    }

    static async get(accountId: string, catalogId: string) {
        await reconcileEligibility(accountId);
        const catalog = await (prisma as any).wholesaleCatalog.findFirst({ where: { id: catalogId, accountId }, include: detailInclude });
        if (!catalog) throw new WholesaleNotFoundError('Catalog not found');
        return flattenCatalog(catalog);
    }

    static async create(accountId: string, userId: string, input: z.infer<typeof catalogInputSchema>) {
        const createdId = await (prisma as any).$transaction(async (tx: any) => {
            const defaults = await tx.wholesaleCatalogDefaults.findUnique({ where: { accountId } });
            const copiedDefaults = copiedCatalogDefaults(defaults, input);
            const catalog = await tx.wholesaleCatalog.create({ data: {
                accountId,
                ...input,
                ...copiedDefaults,
                subtitle: input.subtitle || null,
                coverText: input.coverText || null,
                supplementaryPriceNotice: input.supplementaryPriceNotice || null,
            } });
            await saveRevision(tx, accountId, catalog.id, userId);
            return catalog.id;
        });
        return this.get(accountId, createdId);
    }

    static async update(accountId: string, catalogId: string, userId: string, input: z.infer<typeof catalogInputSchema>) {
        await (prisma as any).$transaction(async (tx: any) => {
            const existing = await tx.wholesaleCatalog.findFirst({ where: { id: catalogId, accountId }, select: { id: true, status: true } });
            if (!existing) throw new WholesaleNotFoundError('Catalog not found');
            if (existing.status === 'ARCHIVED') throw new WholesaleConflictError('Archived catalogs cannot be edited');
            await tx.wholesaleCatalog.update({ where: { id: existing.id }, data: input });
            await saveRevision(tx, accountId, catalogId, userId);
            await markApprovedGenerationsStale(accountId, { code: 'CATALOG_CHANGED', resourceType: 'WHOLESALE_CATALOG', resourceId: catalogId }, catalogId, tx);
        });
        return this.get(accountId, catalogId);
    }

    static async reconcileProducts(accountId: string, catalogId: string, userId: string, productIds: string[]) {
        await (prisma as any).$transaction(async (tx: any) => {
            const catalog = await tx.wholesaleCatalog.findFirst({ where: { id: catalogId, accountId }, select: { status: true } });
            if (!catalog) throw new WholesaleNotFoundError('Catalog not found');
            if (catalog.status === 'ARCHIVED') throw new WholesaleConflictError('Archived catalogs cannot be reconciled');
            const products = await eligibleProducts(tx, accountId, productIds);
            const existing = await tx.wholesaleCatalogProduct.findMany({ where: { accountId, catalogId }, select: { productId: true, isSuspended: true } });
            const selection = reconcilePlacementSelection(existing, productIds);
            if (selection.deleteProductIds.length) {
                await tx.wholesaleCatalogProduct.deleteMany({ where: { accountId, catalogId, productId: { in: selection.deleteProductIds } } });
            }
            for (const product of products) {
                const category = deriveWooCategory(product.rawData);
                await tx.wholesaleCatalogProduct.upsert({
                    where: { catalogId_productId: { catalogId, productId: product.id } },
                    create: { accountId, catalogId, productId: product.id, categoryKey: category.key, categoryLabel: category.label, categorySortOrder: category.sortOrder },
                    update: { categoryKey: category.key, categoryLabel: category.label, categorySortOrder: category.sortOrder, isSuspended: false, suspensionReason: null, suspendedAt: null },
                });
            }
            await saveRevision(tx, accountId, catalogId, userId);
            await markApprovedGenerationsStale(accountId, { code: 'CATALOG_PRODUCTS_CHANGED', resourceType: 'WHOLESALE_CATALOG', resourceId: catalogId }, catalogId, tx);
        });
        return this.get(accountId, catalogId);
    }

    static async applyDefaultTerms(accountId: string, catalogId: string, userId: string) {
        await (prisma as any).$transaction(async (tx: any) => {
            const [catalog, defaults] = await Promise.all([
                tx.wholesaleCatalog.findFirst({ where: { id: catalogId, accountId }, select: { id: true, status: true, paymentCallout: true, footerDetails: true } }),
                tx.wholesaleCatalogDefaults.findUnique({ where: { accountId } }),
            ]);
            if (!catalog) throw new WholesaleNotFoundError('Catalog not found');
            if (catalog.status === 'ARCHIVED') throw new WholesaleConflictError('Archived catalogs cannot be edited');
            if (!defaults?.approvedAt || !defaults?.approvedById) throw new WholesaleValidationError('Approved wholesale defaults must be configured');
            const copied = copiedCatalogDefaults(defaults, { termsSections: [], paymentCallout: catalog.paymentCallout as any, footerDetails: catalog.footerDetails as any });
            await tx.wholesaleCatalog.update({ where: { id: catalogId }, data: { termsSections: copied.termsSections, defaultsVersion: copied.defaultsVersion } });
            await saveRevision(tx, accountId, catalogId, userId);
            await markApprovedGenerationsStale(accountId, { code: 'DEFAULT_TERMS_APPLIED', resourceType: 'WHOLESALE_CATALOG', resourceId: catalogId }, catalogId, tx);
        });
        return this.get(accountId, catalogId);
    }

    static async duplicate(accountId: string, catalogId: string, userId: string) {
        const newId = await (prisma as any).$transaction(async (tx: any) => {
            const source = await tx.wholesaleCatalog.findFirst({ where: { id: catalogId, accountId }, include: { products: true } });
            if (!source) throw new WholesaleNotFoundError('Catalog not found');
            const productIds = source.products.map((placement: any) => placement.productId);
            const products = await eligibleProducts(tx, accountId, productIds);
            const duplicate = await tx.wholesaleCatalog.create({ data: {
                accountId,
                ...editableData(source),
                name: `${source.name} v2`,
                publicTitle: `${source.publicTitle} v2`,
                status: 'DRAFT',
            } });
            await replaceProducts(tx, accountId, duplicate.id, products);
            await saveRevision(tx, accountId, duplicate.id, userId);
            return duplicate.id;
        });
        return this.get(accountId, newId);
    }

    static async remove(accountId: string, catalogId: string) {
        const catalog = await (prisma as any).wholesaleCatalog.findFirst({
            where: { id: catalogId, accountId },
            select: { id: true, _count: { select: { generations: true } } },
        });
        if (!catalog) throw new WholesaleNotFoundError('Catalog not found');
        if (catalog._count.generations > 0) throw new WholesaleConflictError('Catalogs with generations cannot be deleted');
        await (prisma as any).wholesaleCatalog.deleteMany({ where: { id: catalogId, accountId } });
    }

    static async revisions(accountId: string, catalogId: string) {
        const catalog = await (prisma as any).wholesaleCatalog.findFirst({ where: { id: catalogId, accountId }, select: { id: true } });
        if (!catalog) throw new WholesaleNotFoundError('Catalog not found');
        return (prisma as any).wholesaleCatalogRevision.findMany({
            where: { accountId, catalogId },
            orderBy: { revisionNumber: 'desc' },
            take: 25,
        });
    }

    static async restore(accountId: string, catalogId: string, revisionId: string, userId: string) {
        await (prisma as any).$transaction(async (tx: any) => {
            const catalog = await tx.wholesaleCatalog.findFirst({ where: { id: catalogId, accountId }, select: { status: true } });
            if (!catalog) throw new WholesaleNotFoundError('Catalog not found');
            if (catalog.status === 'ARCHIVED') throw new WholesaleConflictError('Archived catalogs cannot be restored');
            const revision = await tx.wholesaleCatalogRevision.findFirst({ where: { id: revisionId, catalogId, accountId } });
            if (!revision) throw new WholesaleNotFoundError('Revision not found');
            const snapshot = revision.snapshot as any;
            if (!snapshot?.catalog || !Array.isArray(snapshot.products)) throw new WholesaleValidationError('Revision snapshot is invalid');
            await tx.wholesaleCatalog.update({ where: { id: catalogId }, data: snapshot.catalog });
            await tx.wholesaleCatalogProduct.deleteMany({ where: { accountId, catalogId } });
            if (snapshot.products.length) {
                const owned = await tx.wooProduct.findMany({ where: { accountId, id: { in: snapshot.products.map((item: any) => item.productId) } }, select: { id: true } });
                if (owned.length !== snapshot.products.length) throw new WholesaleValidationError('Revision contains unavailable products');
                await tx.wholesaleCatalogProduct.createMany({ data: snapshot.products.map((item: any) => ({ ...item, accountId, catalogId })) });
            }
            await saveRevision(tx, accountId, catalogId, userId);
            await markApprovedGenerationsStale(accountId, { code: 'CATALOG_RESTORED', resourceType: 'WHOLESALE_CATALOG', resourceId: catalogId }, catalogId, tx);
        });
        return this.get(accountId, catalogId);
    }
}
