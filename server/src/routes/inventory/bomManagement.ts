import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify } from '../../middleware/auth';
import { PermissionService } from '../../services/PermissionService';
import { WooService } from '../../services/woo';
const include = { bom: { include: { product: { select: { id: true, wooId: true, name: true, accountId: true, status: true } } } }, childProduct: { select: { id: true, wooId: true, name: true, accountId: true, status: true } }, childVariation: { select: { wooId: true, sku: true, productId: true } }, internalProduct: { select: { id: true, name: true, accountId: true } } } as const;
const bomManagementRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
        const keys = request.method === 'GET' ? ['view_products', 'manage_inventory'] : ['edit_products', 'manage_inventory'];
        if (!await PermissionService.hasAnyPermission(request.user.id, request.accountId, keys)) return reply.code(403).send({ error: 'Inventory permission required' });
    });
    fastify.get('/bom/deactivated-items', async (request, reply) => {
        const query = z.object({ cursor: z.string().min(1).max(200).optional(), limit: z.string().regex(/^[1-9]\d*$/).transform(Number).refine(value => value <= 200).optional() }).strict().safeParse(request.query);
        if (!query.success) return reply.code(400).send({ error: 'Invalid pagination' });
        const accountId = request.accountId!, limit = query.data.limit ?? 100;
        const where = { isActive: false, bom: { product: { accountId } } };
        const [found, total] = await Promise.all([prisma.bOMItem.findMany({ where: { ...where, ...(query.data.cursor ? { id: { gt: query.data.cursor } } : {}) }, include, orderBy: { id: 'asc' }, take: limit + 1 }), prisma.bOMItem.count({ where })]);
        const page = found.slice(0, limit);
        const items = page.map(item => ({ id: item.id, bomId: item.bomId, parentProduct: { id: item.bom.product.id, wooId: item.bom.product.wooId, name: item.bom.product.name, variationId: item.bom.variationId },
            component: item.childProduct?.accountId === accountId ? { type: 'WooProduct', id: item.childProduct.id, wooId: item.childProduct.wooId, name: item.childProduct.name, variationWooId: item.childVariation?.wooId, variationSku: item.childVariation?.sku }
                : item.internalProduct?.accountId === accountId ? { type: 'InternalProduct', id: item.internalProduct.id, name: item.internalProduct.name } : { type: 'Unknown' },
            quantity: item.quantity, deactivatedReason: item.deactivatedReason || 'UNKNOWN' }));
        const reasons = new Map<string, number>(); for (const item of items) reasons.set(item.deactivatedReason, (reasons.get(item.deactivatedReason) ?? 0) + 1);
        return { total, items, byReason: Object.fromEntries(reasons), summaryScope: 'page', nextCursor: found.length > limit ? page[page.length - 1].id : null };
    });
    fastify.patch<{ Params: { itemId: string } }>('/bom/items/:itemId/reactivate', async (request, reply) => {
        const id = z.string().min(1).max(200).safeParse(request.params.itemId); if (!id.success) return reply.code(400).send({ error: 'Invalid component ID' });
        const accountId = request.accountId!;
        try {
            const item = await prisma.bOMItem.findFirst({ where: { id: id.data, bom: { product: { accountId } } }, include });
            if (!item) return reply.code(404).send({ error: 'BOM item not found' });
            if (item.bom.product.status === 'trash') return reply.code(409).send({ error: 'Parent product is unavailable' });
            const quantity = Number(item.quantity), waste = Number(item.wasteFactor);
            if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(waste) || waste < 0 || waste > 1 || item.supplierItemId || Number(!!item.childProductId) + Number(!!item.internalProductId) !== 1) return reply.code(409).send({ error: 'Remap and validate this component before reactivation' });
            if (item.childProductId) {
                const child = item.childProduct;
                if (!child || child.accountId !== accountId || child.id === item.bom.productId || child.status === 'trash' || item.childVariationId && !item.childVariation) return reply.code(409).send({ error: 'Component mapping is unavailable or invalid' });
                if (await prisma.bOM.count({ where: { productId: child.id } })) return reply.code(409).send({ error: 'Nested BOM components are unsupported' });
                const woo = await WooService.forAccount(accountId);
                const live = await woo.getProduct(child.wooId, { bypassCache: true });
                if (!live || live.id !== child.wooId || live.status === 'trash') return reply.code(409).send({ error: 'Live component is unavailable' });
                if (item.childVariationId) {
                    const variations = await woo.getProductVariations(child.wooId, { bypassCache: true });
                    if (!variations.some(variation => variation.id === item.childVariationId && variation.status !== 'trash')) return reply.code(409).send({ error: 'Live variation is unavailable' });
                }
            } else if (!item.internalProduct || item.internalProduct.accountId !== accountId || item.childVariationId) return reply.code(409).send({ error: 'Internal component is unavailable' });
            const changed = await prisma.$transaction(async tx => {
                const result = await tx.bOMItem.updateMany({ where: { id: item.id, bomId: item.bomId, childProductId: item.childProductId, childVariationId: item.childVariationId, internalProductId: item.internalProductId, supplierItemId: item.supplierItemId, quantity: item.quantity, wasteFactor: item.wasteFactor, isActive: item.isActive, deactivatedReason: item.deactivatedReason, bom: { product: { accountId } }, OR: [{ childProduct: { accountId } }, { internalProduct: { accountId } }] }, data: { isActive: true, deactivatedReason: null } });
                return result.count === 1;
            });
            if (!changed) return reply.code(409).send({ error: 'Mapping changed during validation; refresh and retry' });
            return { success: true, message: 'Validated component reactivated', itemId: item.id };
        } catch { return reply.code(503).send({ error: 'Could not validate the component; it was not reactivated' }); }
    });
};
export { bomManagementRoutes };
