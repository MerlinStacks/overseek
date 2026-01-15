import { BaseSync, SyncResult } from './BaseSync';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
import { IndexingService } from '../search/IndexingService';
import { SeoScoringService } from '../SeoScoringService';
import { MerchantCenterService } from '../MerchantCenterService';
import { EmbeddingService } from '../EmbeddingService';
import { EventBus, EVENTS } from '../events';
import { Logger } from '../../utils/logger';
import { WooProductSchema, WooProduct } from './wooSchemas';


export class ProductSync extends BaseSync {
    protected entityType = 'products';

    protected async sync(woo: WooService, accountId: string, incremental: boolean, job?: any, syncId?: string): Promise<SyncResult> {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { openRouterApiKey: true, embeddingModel: true }
        });

        const after = incremental ? await this.getLastSync(accountId) : undefined;
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;
        let totalDeleted = 0;
        let totalSkipped = 0;

        const wooProductIds = new Set<number>();

        while (hasMore) {
            const { data: rawProducts, totalPages } = await woo.getProducts({ page, after, per_page: 25 });
            if (!rawProducts.length) {
                hasMore = false;
                break;
            }

            // Validate products with Zod schema, skip invalid ones
            const products: WooProduct[] = [];
            for (const raw of rawProducts) {
                const result = WooProductSchema.safeParse(raw);
                if (result.success) {
                    products.push(result.data);
                } else {
                    totalSkipped++;
                    Logger.warn(`Skipping invalid product`, {
                        accountId, syncId, productId: raw?.id,
                        errors: result.error.issues.map(i => i.message).slice(0, 3)
                    });
                }
            }

            if (!products.length) {
                page++;
                continue;
            }

            // Batch prepare upsert operations
            const upsertOperations = products.map((p) => {
                wooProductIds.add(p.id);
                return prisma.wooProduct.upsert({
                    where: { accountId_wooId: { accountId, wooId: p.id } },
                    update: {
                        name: p.name,
                        price: p.price === '' ? null : p.price,
                        stockStatus: p.stock_status,
                        rawData: p as any,
                        mainImage: p.images?.[0]?.src,
                        weight: p.weight ? parseFloat(p.weight) : null,
                        length: p.dimensions?.length ? parseFloat(p.dimensions.length) : null,
                        width: p.dimensions?.width ? parseFloat(p.dimensions.width) : null,
                        height: p.dimensions?.height ? parseFloat(p.dimensions.height) : null,
                        images: (p.images || []) as any
                    },
                    create: {
                        accountId,
                        wooId: p.id,
                        name: p.name,
                        sku: p.sku,
                        price: p.price === '' ? null : p.price,
                        stockStatus: p.stock_status,
                        permalink: p.permalink,
                        mainImage: p.images?.[0]?.src,
                        weight: p.weight ? parseFloat(p.weight) : null,
                        length: p.dimensions?.length ? parseFloat(p.dimensions.length) : null,
                        width: p.dimensions?.width ? parseFloat(p.dimensions.width) : null,
                        height: p.dimensions?.height ? parseFloat(p.dimensions.height) : null,
                        images: (p.images || []) as any,
                        rawData: p as any
                    }
                });
            });

            // Execute batch transaction
            await prisma.$transaction(upsertOperations);

            // Batch-fetch all upserted products once (avoids N+1 queries)
            const upsertedProducts = await prisma.wooProduct.findMany({
                where: {
                    accountId,
                    wooId: { in: products.map(p => p.id) }
                }
            });
            const productMap = new Map(upsertedProducts.map(p => [p.wooId, p]));

            // Process scoring and indexing
            const indexPromises: Promise<any>[] = [];
            const scoringResults: { seoScore: number; merchantCenterScore: number }[] = [];

            // Score products and batch-collect update operations
            const scoreUpdateOperations = [];
            for (const p of products) {
                const upsertedProduct = productMap.get(p.id);
                if (upsertedProduct) {
                    const currentSeoData = (upsertedProduct.seoData as any) || {};
                    const focusKeyword = currentSeoData.focusKeyword || '';

                    const seoResult = SeoScoringService.calculateScore(upsertedProduct, focusKeyword);
                    const mcResult = MerchantCenterService.validateCompliance(upsertedProduct);

                    scoreUpdateOperations.push(
                        prisma.wooProduct.update({
                            where: { id: upsertedProduct.id },
                            data: {
                                seoScore: seoResult.score,
                                seoData: { ...currentSeoData, analysis: seoResult.tests },
                                merchantCenterScore: mcResult.score,
                                merchantCenterIssues: mcResult.issues as any
                            }
                        })
                    );

                    EmbeddingService.updateProductEmbedding(upsertedProduct.id, accountId, account || undefined, upsertedProduct)
                        .catch((err: any) => Logger.debug('Embedding generation skipped', { productId: upsertedProduct.id, reason: err.message }));

                    scoringResults.push({ seoScore: seoResult.score, merchantCenterScore: mcResult.score });
                } else {
                    scoringResults.push({ seoScore: 0, merchantCenterScore: 0 });
                }
            }

            if (scoreUpdateOperations.length > 0) {
                await prisma.$transaction(scoreUpdateOperations);
            }

            for (let i = 0; i < products.length; i++) {
                const p = products[i];
                const scores = scoringResults[i] || { seoScore: 0, merchantCenterScore: 0 };

                indexPromises.push(
                    IndexingService.indexProduct(accountId, { ...p, ...scores })
                        .catch((error: any) => {
                            Logger.warn(`Failed to index product ${p.id}`, { accountId, syncId, error: error.message });
                        })
                );

                EventBus.emit(EVENTS.PRODUCT.SYNCED, { accountId, product: p });
            }

            await Promise.allSettled(indexPromises);
            totalProcessed += products.length;

            Logger.info(`Synced batch of ${products.length} products`, { accountId, syncId, page, totalPages, skipped: totalSkipped });
            if (products.length < 25) hasMore = false;

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                if (!(await job.isActive())) throw new Error('Cancelled');
            }

            page++;
        }

        // Reconciliation
        if (!incremental && wooProductIds.size > 0) {
            const localProducts = await prisma.wooProduct.findMany({
                where: { accountId },
                select: { id: true, wooId: true }
            });

            const deletePromises: Promise<any>[] = [];
            for (const local of localProducts) {
                if (!wooProductIds.has(local.wooId)) {
                    deletePromises.push(
                        prisma.wooProduct.delete({ where: { id: local.id } })
                            .then(() => IndexingService.deleteProduct(accountId, local.wooId))
                    );
                    totalDeleted++;
                }
            }

            if (deletePromises.length > 0) {
                await Promise.allSettled(deletePromises);
                Logger.info(`Reconciliation: Deleted ${totalDeleted} orphaned products`, { accountId, syncId });
            }
        }

        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }
}
