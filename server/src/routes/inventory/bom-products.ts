import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify } from '../../middleware/auth';
import { bomVariationQuerySchema, bomSaveBodySchema } from './schemas';
import { Logger } from '../../utils/logger';
import { BOMInventorySyncService } from '../../services/BOMInventorySyncService';

function enrichBOMItems(bomItems: any[]): Promise<any[]>;
async function enrichBOMItems(bomItems: any[]) {
    let enrichedItems = [...bomItems];

    const internalItemsNeedingHydration = bomItems.filter(
        item => item.internalProductId && !item.internalProduct
    );
    if (internalItemsNeedingHydration.length > 0) {
        const internalProductIds = [...new Set(internalItemsNeedingHydration.map(i => i.internalProductId!))];
        const internalProducts = await prisma.internalProduct.findMany({
            where: { id: { in: internalProductIds } }
        });
        const internalProductMap = new Map(internalProducts.map(p => [p.id, p]));
        enrichedItems = enrichedItems.map(item => {
            if (!item.internalProductId || item.internalProduct) return item;
            const internalProduct = internalProductMap.get(item.internalProductId);
            if (internalProduct) return { ...item, internalProduct };
            Logger.warn('Internal product not found for BOM item', { bomItemId: item.id, internalProductId: item.internalProductId });
            return item;
        });
    }

    const variantItemsNeedingHydration = bomItems.filter(
        item => item.childProductId && item.childVariationId && !item.childVariation
    );
    if (variantItemsNeedingHydration.length > 0) {
        const parentProductIds = [...new Set(variantItemsNeedingHydration.map(i => i.childProductId!))];
        const parentProducts = await prisma.wooProduct.findMany({
            where: { id: { in: parentProductIds } },
            select: { id: true, name: true, rawData: true }
        });
        const parentMap = new Map(parentProducts.map(p => [p.id, p]));
        const variationKeys = variantItemsNeedingHydration.map(item => ({
            productId: item.childProductId!,
            wooId: item.childVariationId!
        }));
        const existingVariations = await prisma.productVariation.findMany({
            where: { OR: variationKeys.map(k => ({ productId: k.productId, wooId: k.wooId })) }
        });
        const variationLookup = new Map(existingVariations.map(v => [`${v.productId}:${v.wooId}`, v]));
        enrichedItems = enrichedItems.map(item => {
            if (item.childVariation || !item.childProductId || !item.childVariationId) return item;
            const dbVariation = variationLookup.get(`${item.childProductId}:${item.childVariationId}`);
            if (dbVariation) return { ...item, childVariation: dbVariation };
            Logger.warn('BOM item references a variation with no ProductVariation record', {
                bomItemId: item.id,
                childProductId: item.childProductId,
                childVariationId: item.childVariationId,
                parentProductName: parentMap.get(item.childProductId)?.name
            });
            return item;
        });
    }

    return enrichedItems;
}

const bomProductRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/products/:productId/bom', async (request, reply) => {
        const accountId = request.accountId!;
        const { productId } = request.params as { productId: string };
        const parsedQuery = bomVariationQuerySchema.safeParse(request.query);
        if (!parsedQuery.success) return reply.code(400).send({ error: parsedQuery.error.issues[0]?.message || 'Invalid variationId' });
        const { variationId } = parsedQuery.data;
        try {
            const owned = await prisma.wooProduct.findFirst({ where: { id: productId, accountId }, select: { id: true } });
            if (!owned) return reply.code(404).send({ error: 'Product not found' });

            const bom = await prisma.bOM.findUnique({
                where: { productId_variationId: { productId, variationId } },
                include: {
                    items: {
                        include: {
                            supplierItem: { include: { supplier: true } },
                            childProduct: true,
                            childVariation: true,
                            internalProduct: true
                        }
                    }
                }
            });
            if (!bom || !bom.items || bom.items.length === 0) return { items: [] };

            for (const item of bom.items) {
                if (item.internalProductId && !item.internalProduct) {
                    Logger.warn('BOM item has internalProductId but relation is null', { bomItemId: item.id, internalProductId: item.internalProductId });
                }
                if (item.childProductId && item.childVariationId && !item.childVariation) {
                    Logger.debug('BOM item has childVariationId but relation is null', { bomItemId: item.id, childProductId: item.childProductId, childVariationId: item.childVariationId });
                }
            }

            const enrichedItems = await enrichBOMItems(bom.items);
            return { ...bom, items: enrichedItems };
        } catch (error: any) {
            Logger.error('Error fetching BOM', { error, productId, variationId });
            return reply.code(500).send({ error: 'Failed to fetch BOM' });
        }
    });

    fastify.get('/products/:productId/bom/effective-stock', async (request, reply) => {
        const accountId = request.accountId!;
        const { productId } = request.params as { productId: string };
        const parsedQuery = bomVariationQuerySchema.safeParse(request.query);
        if (!parsedQuery.success) return reply.code(400).send({ error: parsedQuery.error.issues[0]?.message || 'Invalid variationId' });
        const { variationId } = parsedQuery.data;
        try {
            const calculation = await BOMInventorySyncService.calculateEffectiveStockLocal(accountId, productId, variationId);
            if (!calculation) return { effectiveStock: null, currentWooStock: null };
            return { effectiveStock: calculation.effectiveStock, currentWooStock: calculation.currentWooStock, needsSync: calculation.needsSync, components: calculation.components };
        } catch (error: any) {
            Logger.error('Error calculating effective stock', { error, productId, variationId });
            return reply.code(500).send({ error: 'Failed to calculate effective stock' });
        }
    });

    fastify.post('/products/:productId/bom', async (request, reply) => {
        const accountId = request.accountId!;
        const { productId } = request.params as { productId: string };
        const parsedBody = bomSaveBodySchema.safeParse(request.body);
        if (!parsedBody.success) return reply.code(400).send({ error: parsedBody.error.issues[0]?.message || 'Invalid BOM payload' });
        const { items, variationId } = parsedBody.data;

        try {
            const parent = await prisma.wooProduct.findFirst({ where: { id: productId, accountId }, select: { id: true } });
            if (!parent) return reply.code(404).send({ error: 'Product not found' });

            const childProductIds = [...new Set(items.map(i => i.childProductId).filter(Boolean) as string[])];
            const internalProductIds = [...new Set(items.map(i => i.internalProductId).filter(Boolean) as string[])];
            const supplierItemIds = [...new Set(items.map(i => i.supplierItemId).filter(Boolean) as string[])];

            const [validChildProducts, validInternalProducts, validSupplierItems] = await Promise.all([
                childProductIds.length > 0 ? prisma.wooProduct.findMany({ where: { accountId, id: { in: childProductIds } }, select: { id: true } }) : [],
                internalProductIds.length > 0 ? prisma.internalProduct.findMany({ where: { accountId, id: { in: internalProductIds } }, select: { id: true } }) : [],
                supplierItemIds.length > 0 ? prisma.supplierItem.findMany({ where: { id: { in: supplierItemIds }, supplier: { accountId } }, select: { id: true } }) : []
            ]);

            const validChildSet = new Set(validChildProducts.map(p => p.id));
            const validInternalSet = new Set(validInternalProducts.map(p => p.id));
            const validSupplierSet = new Set(validSupplierItems.map(p => p.id));

            const invalidItem = items.find(item =>
                (item.childProductId && !validChildSet.has(item.childProductId)) ||
                (item.internalProductId && !validInternalSet.has(item.internalProductId)) ||
                (item.supplierItemId && !validSupplierSet.has(item.supplierItemId))
            );
            if (invalidItem) return reply.code(400).send({ error: 'BOM contains one or more components not owned by this account' });

            const bom = await prisma.bOM.upsert({
                where: { productId_variationId: { productId, variationId } },
                create: { productId, variationId },
                update: {}
            });

            await prisma.$transaction(async (tx) => {
                await tx.bOMItem.deleteMany({ where: { bomId: bom.id } });
                for (const item of items) {
                    if (item.childProductId === productId) continue;
                    await tx.bOMItem.create({
                        data: {
                            bomId: bom.id,
                            supplierItemId: item.supplierItemId || null,
                            childProductId: item.childProductId || null,
                            childVariationId: item.childVariationId || null,
                            internalProductId: item.internalProductId || null,
                            quantity: Number(item.quantity),
                            wasteFactor: Number(item.wasteFactor || 0)
                        }
                    });
                }
            });

            const updated = await prisma.bOM.findUnique({
                where: { id: bom.id },
                include: {
                    items: {
                        include: {
                            supplierItem: { include: { supplier: true } },
                            childProduct: true,
                            childVariation: true,
                            internalProduct: true
                        }
                    }
                }
            });

            let totalCogs = 0;
            const hasBOMItems = updated && updated.items && updated.items.length > 0;
            if (hasBOMItems) {
                totalCogs = updated!.items.reduce((sum, item) => {
                    let unitCost = 0;
                    if (item.childVariation?.cogs) unitCost = Number(item.childVariation.cogs);
                    else if (item.childProduct?.cogs) unitCost = Number(item.childProduct.cogs);
                    else if (item.supplierItem?.cost) unitCost = Number(item.supplierItem.cost);
                    return sum + (unitCost * Number(item.quantity) * (1 + Number(item.wasteFactor)));
                }, 0);
                if (variationId === 0) {
                    await prisma.wooProduct.update({ where: { id: productId }, data: { cogs: totalCogs } });
                } else {
                    await prisma.productVariation.updateMany({ where: { productId, wooId: Number(variationId) }, data: { cogs: totalCogs } });
                }
            }
            return updated;
        } catch (error: any) {
            Logger.error('Error saving BOM', { error, productId, variationId });
            return reply.code(500).send({ error: 'Failed to save BOM' });
        }
    });
};

export default bomProductRoutes;
