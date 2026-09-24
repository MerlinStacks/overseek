import { Prisma } from '@prisma/client';
import { requestSettingsRevalidation } from './revalidation';
import { prisma } from '../../utils/prisma';
import { dirtyInboundProducts, lockDeliveryAccount, recordProductIntent, recordSettingsIntent } from './intents';
import { defaultSettings, DeliverySettings, ProductInput, ProductionRange, productInputSchema, settingsSchema } from './validation';

/** @deprecated Historical draft-only compatibility export. Routes use deliveryLocalStatus/readiness, never this constant. */
export const deliveryStatus = { syncStatus: 'plugin_update_required', storefrontActivated: false } as const;
const rangeSelect = { productionMinDays: true, productionMaxDays: true } as const;
const productSelect = {
    id: true, wooId: true, ...rangeSelect,
    variations: { where: { deliveryActive: true }, select: { id: true, wooId: true, ...rangeSelect }, orderBy: { wooId: 'asc' as const } },
} as const;

/** Distinguishes tenant-safe missing resources from operational failures. */
export class DeliveryResourceNotFound extends Error {}

/** Explicit zero overrides the parent; only paired nulls inherit. */
export function resolveProductionRange(own: ProductionRange, parent?: ProductionRange) {
    const resolved = own.productionMinDays !== null ? own : parent;
    return {
        effectiveProductionMinDays: resolved?.productionMinDays ?? null,
        effectiveProductionMaxDays: resolved?.productionMaxDays ?? null,
        source: own.productionMinDays !== null ? 'override' : parent?.productionMinDays != null ? 'parent' : 'unset',
    };
}

/** Account-owned persistence and transactional delivery intents; no network I/O. */
export class DeliveryEstimateService {
    /** Read draft defaults without mutating an unconfigured account. */
    static async getSettings(accountId: string) {
        const stored = await prisma.deliveryEstimateSettings.findUnique({ where: { accountId } });
        if (stored) return settingsSchema.parse(stored.settings);
        const account = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } });
        if (!account) throw new DeliveryResourceNotFound('Account not found');
        return defaultSettings(account.timezone);
    }

    /** Replace the complete validated settings document for this account only. */
    static async saveSettings(accountId: string, input: DeliverySettings) {
        const settings = settingsSchema.parse(input);
        await prisma.$transaction(async tx => {
            await lockDeliveryAccount(tx, accountId);
            await tx.deliveryEstimateSettings.upsert({
                where: { accountId }, create: { accountId, settings }, update: { settings },
            });
            await recordSettingsIntent(tx, accountId);
            await requestSettingsRevalidation(tx, accountId);
        });
        return settings;
    }

    /** Read product and variation inputs with tenant ownership enforced in the query. */
    static async getProduct(accountId: string, id: string, db: Prisma.TransactionClient = prisma) {
        const product = await db.wooProduct.findFirst({ where: { id, accountId }, select: productSelect });
        if (!product) throw new DeliveryResourceNotFound('Product not found');
        return { ...product, ...resolveProductionRange(product), variations: product.variations.map(variation => ({
            ...variation, ...resolveProductionRange(variation, product),
        })) };
    }

    /** Validate every variation belongs to this product before any atomic local writes. */
    static async saveProduct(accountId: string, id: string, input: ProductInput) {
        input = productInputSchema.parse(input);
        return prisma.$transaction(async tx => {
            await lockDeliveryAccount(tx, accountId);
            const existing = await this.getProduct(accountId, id, tx);
            const allowed = new Set(existing.variations.map(variation => variation.id));
            if (input.variations?.some(variation => !allowed.has(variation.id))) {
                throw new DeliveryResourceNotFound('Variation not found for product');
            }
            const updated = await tx.wooProduct.updateMany({ where: { id, accountId }, data: {
                productionMinDays: input.productionMinDays, productionMaxDays: input.productionMaxDays,
            } });
            if (updated.count !== 1) throw new DeliveryResourceNotFound('Product not found');
            for (const variation of input.variations ?? []) {
                const updatedVariation = await tx.productVariation.updateMany({
                    where: { id: variation.id, productId: id, product: { accountId }, deliveryActive: true },
                    data: { productionMinDays: variation.productionMinDays, productionMaxDays: variation.productionMaxDays },
                });
                if (updatedVariation.count !== 1) throw new DeliveryResourceNotFound('Variation not found for product');
            }
            const product = await this.getProduct(accountId, id, tx);
            await recordProductIntent(tx, accountId, product);
            await dirtyInboundProducts(tx, accountId, [product.wooId]);
            return product;
        });
    }
}
