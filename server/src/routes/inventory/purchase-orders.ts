import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { PurchaseOrderService } from '../../services/PurchaseOrderService';
import { GuardedReceiptError } from '../../services/deliveryEstimates/receipts';
import { IndexingService } from '../../services/search/IndexingService';
import { invalidateCache } from '../../utils/cache';
import { z } from 'zod';
import { PermissionService } from '../../services/PermissionService';

const poService = new PurchaseOrderService();

function backgroundReindex(accountId: string, productIds: string[]) {
    setImmediate(() => {
        (async () => {
            for (const productId of productIds) {
                try {
                    const product = await prisma.wooProduct.findFirst({ where: { id: productId, accountId }, include: { variations: true } });
                    if (product) {
                        await IndexingService.indexProduct(accountId, {
                            ...product,
                            variations: product.variations.map(v => ({ ...v, id: v.wooId }))
                        });
                    }
                } catch (indexErr: any) {
                    Logger.warn('Failed to re-index product after PO operation', { productId, error: indexErr.message });
                }
            }
            await invalidateCache('products', accountId);
        })().catch(err => Logger.error('Background ES re-index failed', { error: err }));
    });
}

const purchaseOrderRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.get('/purchase-orders/overview', async (request, reply) => {
        if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Selected account required' });
        if (!await PermissionService.hasPermission(request.user.id, request.accountId, 'view_inventory')) return reply.code(403).send({ error: 'Inventory read permission required' });
        const parsed = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), status: z.enum(['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED']).optional() }).strict().safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: 'Invalid purchase-order page' });
        const { page, limit, status } = parsed.data, where = { accountId: request.accountId, ...(status ? { status } : {}) };
        try {
            return await prisma.$transaction(async tx => {
                const total = await tx.purchaseOrder.count({ where });
                const orders = await tx.purchaseOrder.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit, select: { id: true, orderNumber: true, status: true, totalAmount: true, supplier: { select: { name: true } }, orderDate: true, expectedDate: true, createdAt: true, trackingLink: true } });
                return { orders, total, page, limit, monetaryBasis: 'currency and receipt timestamps are not recorded on these purchase orders' };
            }, { isolationLevel: 'RepeatableRead' });
        } catch { return reply.code(503).send({ error: 'Purchase-order overview unavailable' }); }
    });

    fastify.get('/purchase-orders', async (request, reply) => {
        const accountId = request.accountId!;
        const { status } = request.query as { status?: string };
        try {
            return await poService.listPurchaseOrders(accountId, status);
        } catch (error: any) {
            return reply.code(500).send({ error: 'Failed to fetch POs' });
        }
    });

    fastify.get('/purchase-orders/:id', async (request, reply) => {
        const accountId = request.accountId!;
        const { id } = request.params as { id: string };
        try {
            const po = await poService.getPurchaseOrder(accountId, id);
            if (!po) return reply.code(404).send({ error: 'PO not found' });
            return po;
        } catch (error: any) {
            return reply.code(500).send({ error: 'Failed to fetch PO' });
        }
    });

    fastify.post('/purchase-orders', async (request, reply) => {
        const accountId = request.accountId!;
        try {
            const body = request.body as any;
            const shouldReceiveStock = body.status === 'RECEIVED';
            const created = await poService.createPurchaseOrder(accountId, {
                ...body,
                status: shouldReceiveStock ? 'ORDERED' : body.status,
            });

            if (!shouldReceiveStock) return created;

            const stockResult = await poService.receiveStock(accountId, created.id);
            Logger.info('Stock received from newly created PO', { poId: created.id, ...stockResult });
            backgroundReindex(accountId, [...stockResult.updatedProductIds]);

            const updated = await poService.getPurchaseOrder(accountId, created.id);
            if (stockResult.errors.length) {
                return { ...updated, _warnings: stockResult.errors };
            }
            return updated;
        } catch (error: any) {
            const msg = error?.message || '';
            if (msg === 'Supplier not found') return reply.code(404).send({ error: msg });
            if (msg === 'One or more PO items are invalid for this account') return reply.code(400).send({ error: msg });
            if (msg === 'Invalid Purchase Order status' || msg === 'Invalid Purchase Order expected date') return reply.code(400).send({ error: msg });
            if (msg === 'Variation requires a valid linked parent product' || msg === 'Variation not found for linked parent product') return reply.code(400).send({ error: msg });
            if (error instanceof GuardedReceiptError) return reply.code(409).send({ error: error.message });
            Logger.error('Error creating PO', { error });
            return reply.code(500).send({ error: 'Failed to create PO' });
        }
    });

    fastify.put('/purchase-orders/:id', async (request, reply) => {
        const accountId = request.accountId!;
        const { id } = request.params as { id: string };
        const body = request.body as { status?: string; items?: any[] };
        const { status } = body;

        try {
            let stockResult: { updated: number; errors: string[]; updatedProductIds: string[] } | null = null;
            const existingPO = await poService.getPurchaseOrder(accountId, id);
            const wasReceived = existingPO?.status === 'RECEIVED';
            const isTransitioningToReceived = status === 'RECEIVED' && !wasReceived;
            const isTransitioningFromReceived = wasReceived && status != null && status !== 'RECEIVED';

            if (wasReceived && body.items && !isTransitioningFromReceived) {
                return reply.code(400).send({ error: 'Cannot edit items on a RECEIVED PO. Change status to DRAFT or ORDERED first.' });
            }

            if (isTransitioningFromReceived) {
                const result = await poService.unreceiveStock(accountId, id);
                Logger.info('Stock unreceived from PO', { poId: id, ...result });
                backgroundReindex(accountId, [...result.updatedProductIds]);
            }

            if (isTransitioningToReceived) {
                const { status: _status, ...fieldsWithoutStatus } = body;
                await poService.updatePurchaseOrder(accountId, id, fieldsWithoutStatus as any);
                stockResult = await poService.receiveStock(accountId, id);
                Logger.info('Stock received from PO', { poId: id, ...stockResult });
                backgroundReindex(accountId, [...stockResult.updatedProductIds]);
            } else {
                await poService.updatePurchaseOrder(accountId, id, body as any);
            }

            const updated = await poService.getPurchaseOrder(accountId, id);
            if (stockResult?.errors?.length) {
                return { ...updated, _warnings: stockResult.errors };
            }
            return updated;
        } catch (error: any) {
            const msg = error?.message || '';
            if (msg === 'Supplier not found') return reply.code(404).send({ error: msg });
            if (msg === 'One or more PO items are invalid for this account') return reply.code(400).send({ error: msg });
            if (msg === 'Invalid Purchase Order status' || msg === 'Invalid Purchase Order expected date') return reply.code(400).send({ error: msg });
            if (msg === 'Variation requires a valid linked parent product' || msg === 'Variation not found for linked parent product') return reply.code(400).send({ error: msg });
            if (error instanceof GuardedReceiptError) return reply.code(409).send({ error: error.message });
            Logger.error('Error updating PO', { error, poId: id });
            return reply.code(500).send({ error: 'Failed to update PO' });
        }
    });

    fastify.delete('/purchase-orders/:id', async (request, reply) => {
        const accountId = request.accountId!;
        const { id } = request.params as { id: string };
        try {
            await poService.deletePurchaseOrder(accountId, id);
            return { success: true };
        } catch (error: any) {
            const msg = error.message;
            if (msg === 'Purchase Order not found') return reply.code(404).send({ error: msg });
            if (msg === 'Only DRAFT Purchase Orders can be deleted') return reply.code(400).send({ error: msg });
            Logger.error('Error deleting PO', { error, poId: id });
            return reply.code(500).send({ error: 'Failed to delete PO' });
        }
    });
};

export default purchaseOrderRoutes;
