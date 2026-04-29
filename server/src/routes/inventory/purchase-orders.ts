import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { PurchaseOrderService } from '../../services/PurchaseOrderService';
import { IndexingService } from '../../services/search/IndexingService';
import { invalidateCache } from '../../utils/cache';

const poService = new PurchaseOrderService();

function backgroundReindex(accountId: string, productIds: string[]) {
    setImmediate(() => {
        (async () => {
            for (const productId of productIds) {
                try {
                    const product = await prisma.wooProduct.findUnique({ where: { id: productId }, include: { variations: true } });
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
            return await poService.createPurchaseOrder(accountId, request.body as any);
        } catch (error: any) {
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
