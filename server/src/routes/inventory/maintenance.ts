import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { PurchaseOrderService } from '../../services/PurchaseOrderService';
import { IndexingService } from '../../services/search/IndexingService';
import { invalidateCache } from '../../utils/cache';

const poService = new PurchaseOrderService();
const MAX_REPROCESS_ERRORS = 200;

/** In-memory progress tracker for long-running reprocess operations */
const reprocessProgress = new Map<string, {
    status: 'running' | 'completed' | 'failed';
    startedAt: string;
    completedAt?: string;
    totalPOs: number;
    processed: number;
    variationsBackfilled: number;
    errors: string[];
    errorCount: number;
}>();

async function reindexAllProducts(accountId: string) {
    const products = await prisma.wooProduct.findMany({ where: { accountId }, include: { variations: true } });
    let reindexed = 0;
    const errors: string[] = [];
    for (const product of products) {
        try {
            await IndexingService.indexProduct(accountId, {
                ...product,
                variations: product.variations.map(v => ({ ...v, id: v.wooId }))
            });
            reindexed++;
        } catch (err: any) {
            errors.push(`Failed to re-index ${product.name}: ${err.message}`);
        }
    }
    await invalidateCache('products', accountId);
    return { reindexed, errors };
}

const maintenanceRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    fastify.post('/repair-received-pos', async (request, reply) => {
        const accountId = request.accountId!;
        try {
            const { reindexed, errors } = await reindexAllProducts(accountId);
            Logger.info('Repair completed: re-indexed all products', { accountId, reindexed, errors: errors.length });
            return { success: true, reindexed, errors: errors.length > 0 ? errors : undefined };
        } catch (error: any) {
            Logger.error('Error repairing products', { error });
            return reply.code(500).send({ error: 'Failed to repair products' });
        }
    });

    fastify.post('/reprocess-received-pos', async (request, reply) => {
        const accountId = request.accountId!;
        const existing = reprocessProgress.get(accountId);
        if (existing?.status === 'running') {
            return reply.code(409).send({ success: false, message: 'Reprocessing already in progress', progress: existing });
        }

        const poCount = await prisma.purchaseOrder.count({ where: { accountId, status: 'RECEIVED' } });
        if (poCount === 0) return { success: true, message: 'No RECEIVED POs found', processed: 0 };

        reprocessProgress.set(accountId, {
            status: 'running',
            startedAt: new Date().toISOString(),
            totalPOs: poCount,
            processed: 0,
            variationsBackfilled: 0,
            errors: [],
            errorCount: 0
        });

        reply.code(202).send({
            success: true,
            message: `Processing ${poCount} RECEIVED POs in background. Poll GET /reprocess-status for progress.`
        });

        setImmediate(() => {
            (async () => {
                Logger.info('[Reprocess] Starting background PO reprocessing', { accountId, poCount });
                const progress = reprocessProgress.get(accountId)!;

                const receivedPOs = await prisma.purchaseOrder.findMany({
                    where: { accountId, status: 'RECEIVED' },
                    include: {
                        items: {
                            include: {
                                product: {
                                    include: {
                                        variations: true,
                                        boms: {
                                            select: {
                                                id: true,
                                                items: {
                                                    where: { OR: [{ childProductId: { not: null } }, { internalProductId: { not: null } }] },
                                                    select: { id: true }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                });

                for (const po of receivedPOs) {
                    const poLabel = po.orderNumber || po.id.slice(0, 8);
                    try {
                        await poService.unreceiveStock(accountId, po.id);
                        Logger.info(`[Reprocess] Unreceived PO ${poLabel}`, { accountId });

                        for (const item of po.items) {
                            if (!item.productId || !item.product) continue;
                            if (item.variationWooId) continue;
                            if (!item.sku || item.product.variations.length === 0) continue;
                            const matched = item.product.variations.find(v => v.sku === item.sku);
                            if (matched) {
                                await prisma.purchaseOrderItem.update({ where: { id: item.id }, data: { variationWooId: matched.wooId } });
                                progress.variationsBackfilled++;
                            }
                        }

                        await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'DRAFT' } });
                        const result = await poService.receiveStock(accountId, po.id);
                        if (result.errors.length > 0) {
                            progress.errorCount += result.errors.length;
                            if (progress.errors.length < MAX_REPROCESS_ERRORS) {
                                progress.errors.push(...result.errors.slice(0, MAX_REPROCESS_ERRORS - progress.errors.length).map(e => `PO ${poLabel}: ${e}`));
                            }
                        }
                        await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'RECEIVED' } });
                    } catch (err: any) {
                        Logger.error(`[Reprocess] Failed PO ${poLabel}, restoring status`, { error: err.message });
                        progress.errorCount++;
                        if (progress.errors.length < MAX_REPROCESS_ERRORS) {
                            progress.errors.push(`PO ${poLabel} failed: ${err.message}`);
                        }
                        try { await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'RECEIVED' } }); }
                        catch (restoreErr: any) { Logger.error(`[Reprocess] CRITICAL: Could not restore PO ${poLabel}`, { error: restoreErr.message }); }
                    }
                    progress.processed++;
                }

                await reindexAllProducts(accountId);
                progress.status = progress.errors.length > 0 ? 'failed' : 'completed';
                progress.completedAt = new Date().toISOString();
                Logger.info('[Reprocess] Completed', { accountId, totalPOs: receivedPOs.length, variationsBackfilled: progress.variationsBackfilled, errors: progress.errors.length });
                setTimeout(() => reprocessProgress.delete(accountId), 10 * 60 * 1000);
            })().catch(error => {
                Logger.error('[Reprocess] Background reprocessing failed', { accountId, error });
                const progress = reprocessProgress.get(accountId);
                if (progress) {
                    progress.status = 'failed'; progress.completedAt = new Date().toISOString(); progress.errorCount++;
                    if (progress.errors.length < MAX_REPROCESS_ERRORS) progress.errors.push(`Fatal: ${(error as Error).message}`);
                }
                setTimeout(() => reprocessProgress.delete(accountId), 10 * 60 * 1000);
            });
        });
    });

    fastify.get('/reprocess-status', async (request) => {
        const accountId = request.accountId!;
        const progress = reprocessProgress.get(accountId);
        if (!progress) return { status: 'idle', message: 'No reprocess operation running or recently completed' };
        return progress;
    });
};

export default maintenanceRoutes;
