import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';

const querySchema = z.object({
    limit: z.coerce.number().int().positive().max(200).default(100),
    page: z.coerce.number().int().positive().default(1),
    productId: z.string().trim().min(1).optional()
});

type Movement = {
    id: string;
    productId: string;
    productName: string;
    sku: string | null;
    previousStock: number | null;
    newStock: number | null;
    quantity: number;
    type: string;
    reference: string | null;
    orderId: number | null;
    reason: string | null;
    createdAt: Date;
    isBomProduct: boolean;
    bomParents: Array<{ id: string; name: string; variationId: number; variantLabel: string | null; sku: string | null }>;
};

function getVariationLabel(rawData: unknown, sku: string | null, wooId: number): string {
    const raw = rawData as { attributes?: Array<{ name?: string; option?: string }> } | null;
    const attributes = Array.isArray(raw?.attributes)
        ? raw.attributes.map((attribute) => attribute.option || attribute.name).filter(Boolean)
        : [];
    return attributes.join(' / ') || sku || `Variation #${wooId}`;
}

function getOrderId(value: unknown): number | null {
    const id = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export const stockMovementRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get('/stock-movements', async (request, reply) => {
        const parsed = querySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Invalid limit' });
        }

        const accountId = request.accountId!;
        const { limit, page, productId } = parsed.data;

        try {
            const scopedProduct = productId ? await prisma.wooProduct.findFirst({
                where: { accountId, id: productId },
                select: { id: true, wooId: true, name: true, sku: true }
            }) : null;
            if (productId && !scopedProduct) return reply.code(404).send({ error: 'Product not found' });

            const [auditLogs, ledgerEntries] = await Promise.all([
                prisma.auditLog.findMany({
                    where: {
                        accountId,
                        resource: 'PRODUCT',
                        action: 'UPDATE',
                        ...(scopedProduct ? { resourceId: { in: [scopedProduct.id, String(scopedProduct.wooId)] } } : {})
                    },
                    orderBy: { createdAt: 'desc' },
                    ...(scopedProduct ? {} : { take: limit * 2 }),
                    select: {
                        id: true,
                        resourceId: true,
                        source: true,
                        previousValue: true,
                        details: true,
                        createdAt: true
                    }
                }),
                prisma.bOMDeductionLedger.findMany({
                    where: {
                        accountId, status: { in: ['COMPLETED', 'REVERSED'] },
                        ...(scopedProduct ? { componentId: scopedProduct.id, componentType: { in: ['WooProduct', 'ProductVariation'] } } : {})
                    },
                    orderBy: { createdAt: 'desc' },
                    ...(scopedProduct ? {} : { take: limit }),
                    select: {
                        id: true,
                        orderId: true,
                        componentType: true,
                        componentId: true,
                        componentName: true,
                        wooId: true,
                        quantityDeducted: true,
                        previousStock: true,
                        newStock: true,
                        status: true,
                        createdAt: true,
                        rolledBackAt: true
                    }
                })
            ]);

            const stockLogs = auditLogs.flatMap((log) => {
                const previous = log.previousValue as Record<string, unknown> | null;
                const details = log.details as Record<string, unknown> | null;
                // Null/empty balances mean unknown, not zero. Keep legacy global conversion unchanged.
                if (scopedProduct && (details?.productType === 'INTERNAL'
                    || ![previous?.stock_quantity, details?.stock_quantity].every(value =>
                        typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')))) return [];
                const previousStock = Number(previous?.stock_quantity);
                const newStock = Number(details?.stock_quantity);
                if (!Number.isFinite(previousStock) || !Number.isFinite(newStock) || previousStock === newStock) return [];
                return [{ ...log, resourceId: scopedProduct?.id || log.resourceId, previousStock, newStock, details: details || {} }];
            });

            const wooProductIds = new Set<string>();
            const internalProductIds = new Set<string>();
            if (scopedProduct) wooProductIds.add(scopedProduct.id);
            for (const log of stockLogs) {
                if (log.details.productType === 'INTERNAL') internalProductIds.add(log.resourceId);
                else wooProductIds.add(log.resourceId);
            }
            for (const entry of ledgerEntries) {
                if (entry.componentType === 'InternalProduct') internalProductIds.add(entry.componentId);
                else wooProductIds.add(entry.componentId);
            }

            const [wooProducts, internalProducts, bomItems, ownBoms, orders] = await Promise.all([
                prisma.wooProduct.findMany({
                    where: { accountId, id: { in: [...wooProductIds] } },
                    select: { id: true, name: true, sku: true }
                }),
                prisma.internalProduct.findMany({
                    where: { accountId, id: { in: [...internalProductIds] } },
                    select: { id: true, name: true, sku: true }
                }),
                prisma.bOMItem.findMany({
                    where: {
                        isActive: true,
                        bom: { product: { accountId } },
                        OR: [
                            { childProductId: { in: [...wooProductIds] } },
                            { internalProductId: { in: [...internalProductIds] } }
                        ]
                    },
                    select: {
                        childProductId: true,
                        childVariationId: true,
                        internalProductId: true,
                        bom: { select: { variationId: true, product: { select: { id: true, name: true } } } }
                    }
                }),
                prisma.bOM.findMany({
                    where: { product: { accountId }, productId: { in: [...wooProductIds] }, items: { some: { isActive: true } } },
                    select: { productId: true, variationId: true }
                }),
                prisma.wooOrder.findMany({
                    where: { accountId, wooId: { in: [...new Set([
                        ...ledgerEntries.map((entry) => entry.orderId),
                        ...stockLogs.flatMap(log => getOrderId(log.details.orderId) ? [getOrderId(log.details.orderId)!] : [])
                    ])] } },
                    select: { wooId: true, number: true }
                })
            ]);

            const productMap = new Map(wooProducts.map((product) => [product.id, product]));
            const internalMap = new Map(internalProducts.map((product) => [product.id, product]));
            const orderMap = new Map(orders.map((order) => [order.wooId, order.number]));
            const variationPairs = new Map<string, { productId: string; wooId: number }>();
            for (const item of bomItems) {
                if (item.childProductId && item.childVariationId) {
                    variationPairs.set(`${item.childProductId}:${item.childVariationId}`, {
                        productId: item.childProductId,
                        wooId: item.childVariationId
                    });
                }
                if (item.bom.variationId) {
                    variationPairs.set(`${item.bom.product.id}:${item.bom.variationId}`, {
                        productId: item.bom.product.id,
                        wooId: item.bom.variationId
                    });
                }
            }
            for (const bom of ownBoms) {
                if (bom.variationId) {
                    variationPairs.set(`${bom.productId}:${bom.variationId}`, {
                        productId: bom.productId,
                        wooId: bom.variationId
                    });
                }
            }
            for (const entry of ledgerEntries) {
                if (entry.componentType === 'ProductVariation' && entry.wooId) {
                    variationPairs.set(`${entry.componentId}:${entry.wooId}`, { productId: entry.componentId, wooId: entry.wooId });
                }
            }
            for (const log of stockLogs) {
                const variationId = Number(log.details.variationWooId || 0);
                if (variationId) variationPairs.set(`${log.resourceId}:${variationId}`, { productId: log.resourceId, wooId: variationId });
            }
            const pairs = [...variationPairs.values()];
            const variations = pairs.length > 0
                ? await prisma.productVariation.findMany({
                    where: { OR: pairs },
                    select: { productId: true, wooId: true, sku: true, rawData: true }
                })
                : [];
            const variationMap = new Map(variations.map((variation) => [`${variation.productId}:${variation.wooId}`, variation]));
            const bomParents = new Map<string, Movement['bomParents']>();
            for (const item of bomItems) {
                const key = item.internalProductId
                    ? `internal:${item.internalProductId}`
                    : `woo:${item.childProductId}:${item.childVariationId ?? 0}`;
                const parents = bomParents.get(key) || [];
                if (!parents.some((parent) => parent.id === item.bom.product.id && parent.variationId === item.bom.variationId)) {
                    const variation = variationMap.get(`${item.bom.product.id}:${item.bom.variationId}`);
                    parents.push({
                        id: item.bom.product.id,
                        name: item.bom.product.name,
                        variationId: item.bom.variationId,
                        variantLabel: variation ? getVariationLabel(variation.rawData, variation.sku, variation.wooId) : null,
                        sku: variation?.sku || null
                    });
                }
                bomParents.set(key, parents);
            }
            const ownBomKeys = new Set(ownBoms.map((bom) => `${bom.productId}:${bom.variationId}`));

            const movements: Movement[] = stockLogs.map((log) => {
                const product = productMap.get(log.resourceId) || internalMap.get(log.resourceId);
                const variationId = Number(log.details.variationWooId || 0);
                const variation = variationMap.get(`${log.resourceId}:${variationId}`);
                const isInternal = log.details.productType === 'INTERNAL' || internalMap.has(log.resourceId);
                const movementType = typeof log.details.movementType === 'string'
                    ? log.details.movementType
                    : log.source === 'SYSTEM_BOM' ? 'BOM_SYNC' : log.source === 'USER' ? 'ADJUSTMENT' : 'SYNC';
                return {
                    id: `audit:${log.id}`,
                    productId: log.resourceId,
                    productName: variation && product
                        ? `${product.name} - ${getVariationLabel(variation.rawData, variation.sku, variation.wooId)}`
                        : product?.name || String(log.details.productName || 'Unknown product'),
                    sku: variation?.sku || product?.sku || null,
                    previousStock: log.previousStock,
                    newStock: log.newStock,
                    quantity: log.newStock - log.previousStock,
                    type: movementType,
                    reference: typeof log.details.reference === 'string' ? log.details.reference : null,
                    orderId: getOrderId(log.details.orderId),
                    reason: typeof log.details.reason === 'string' ? log.details.reason : null,
                    createdAt: log.createdAt,
                    isBomProduct: !isInternal && (ownBomKeys.has(`${log.resourceId}:${variationId}`) || ownBomKeys.has(`${log.resourceId}:0`)),
                    bomParents: bomParents.get(isInternal ? `internal:${log.resourceId}` : `woo:${log.resourceId}:${variationId}`) || []
                };
            });

            for (const entry of ledgerEntries) {
                const isInternal = entry.componentType === 'InternalProduct';
                const variationId = entry.componentType === 'ProductVariation' ? entry.wooId || 0 : 0;
                const product = isInternal ? internalMap.get(entry.componentId) : productMap.get(entry.componentId);
                const variation = variationMap.get(`${entry.componentId}:${variationId}`);
                const parents = bomParents.get(isInternal
                    ? `internal:${entry.componentId}`
                    : `woo:${entry.componentId}:${variationId}`) || [];
                const reference = orderMap.get(entry.orderId) || `#${entry.orderId}`;
                movements.push({
                    id: `ledger:${entry.id}:deduction`,
                    productId: entry.componentId,
                    productName: variation && product
                        ? `${product.name} - ${getVariationLabel(variation.rawData, variation.sku, variation.wooId)}`
                        : product?.name || entry.componentName,
                    sku: variation?.sku || product?.sku || null,
                    previousStock: entry.previousStock,
                    newStock: entry.newStock,
                    quantity: -entry.quantityDeducted,
                    type: 'ORDER_CONSUMPTION',
                    orderId: entry.orderId,
                    reference,
                    reason: 'BOM components consumed by order',
                    createdAt: entry.createdAt,
                    isBomProduct: ownBomKeys.has(`${entry.componentId}:${variationId}`) || ownBomKeys.has(`${entry.componentId}:0`),
                    bomParents: parents
                });
                if (entry.status === 'REVERSED' && entry.rolledBackAt) {
                    movements.push({
                        id: `ledger:${entry.id}:reversal`,
                        productId: entry.componentId,
                        productName: variation && product
                            ? `${product.name} - ${getVariationLabel(variation.rawData, variation.sku, variation.wooId)}`
                            : product?.name || entry.componentName,
                        sku: variation?.sku || product?.sku || null,
                        previousStock: entry.newStock,
                        newStock: entry.previousStock,
                        quantity: entry.quantityDeducted,
                        type: 'ORDER_REVERSAL',
                        orderId: entry.orderId,
                        reference,
                        reason: 'BOM consumption reversed',
                        createdAt: entry.rolledBackAt,
                        isBomProduct: ownBomKeys.has(`${entry.componentId}:${variationId}`) || ownBomKeys.has(`${entry.componentId}:0`),
                        bomParents: parents
                    });
                }
            }

            if (scopedProduct) {
                // Match the sales-history route's revenue statuses, without ES result-window/inner-hit limits.
                const saleOrders = await prisma.wooOrder.findMany({
                    where: {
                        accountId,
                        status: { in: REVENUE_STATUSES },
                        rawData: { path: ['line_items'], array_contains: [{ product_id: scopedProduct.wooId }] }
                    },
                    select: { wooId: true, number: true, dateCreated: true, rawData: true }
                });
                const representedQuantities = new Map<number, number>();
                for (const movement of movements) {
                    if (movement.orderId !== null && movement.quantity < 0) {
                        representedQuantities.set(movement.orderId,
                            (representedQuantities.get(movement.orderId) || 0) - movement.quantity);
                    }
                }
                for (const order of saleOrders) {
                    const raw = order.rawData as { line_items?: Array<{ product_id?: number; quantity?: number }> } | null;
                    const quantity = Array.isArray(raw?.line_items) ? raw.line_items.reduce((sum, item) =>
                        item.product_id === scopedProduct.wooId && typeof item.quantity === 'number' && Number.isFinite(item.quantity)
                            ? sum + item.quantity : sum, 0) : 0;
                    if (quantity <= 0) continue;
                    // Only suppress a sale when linked deductions account for its full quantity.
                    // A partial/component movement alone is not evidence that the sale is represented.
                    if (representedQuantities.get(order.wooId) === quantity) continue;
                    movements.push({
                        id: `sale:${order.wooId}:${scopedProduct.id}`,
                        productId: scopedProduct.id, productName: scopedProduct.name, sku: scopedProduct.sku,
                        previousStock: null, newStock: null, quantity: -quantity, type: 'SALE',
                        orderId: order.wooId, reference: order.number || `#${order.wooId}`,
                        reason: 'Product sold in order; stock balances unavailable', createdAt: order.dateCreated,
                        isBomProduct: ownBoms.length > 0, bomParents: bomParents.get(`woo:${scopedProduct.id}:0`) || []
                    });
                }
            }

            movements.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()
                || (scopedProduct ? a.id.localeCompare(b.id) : 0));
            if (scopedProduct) {
                return {
                    movements: movements.slice((page - 1) * limit, page * limit),
                    total: movements.length, page, limit, totalPages: Math.ceil(movements.length / limit)
                };
            }
            const visibleMovements = movements.filter((movement) => movement.type !== 'BOM_SYNC');
            return { movements: visibleMovements.slice(0, limit), total: Math.min(visibleMovements.length, limit) };
        } catch (error) {
            Logger.error('Failed to fetch stock movements', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch stock movements' });
        }
    });
};
