import { BaseSync, SyncResult } from './BaseSync';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
import { IndexingService } from '../search/IndexingService';
import { SeoScoringService } from '../SeoScoringService';
import { MerchantCenterService } from '../MerchantCenterService';
import { EmbeddingService } from '../EmbeddingService';
import { EventBus, EVENTS } from '../events';
import { Logger } from '../../utils/logger';
import { WooProductSchema, WooProduct, safeParseVariations } from './wooSchemas';


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
        let totalVariationsSynced = 0;

        const syncStartedAt = new Date();

        while (hasMore) {
            const { data: rawProducts, totalPages } = await woo.getProducts({ page, after, per_page: 100 });
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
                    Logger.debug(`Skipping invalid product`, {
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

                // EDGE CASE: Log empty price strings for visibility
                // Empty string from WooCommerce typically means "price not set" (e.g., variable product with variant-level pricing)
                if (p.price === '') {
                    Logger.debug('[ProductSync] Product has empty price string', {
                        accountId, syncId, productId: p.id, productName: p.name, type: p.type
                    });
                }

                // Determine price: empty string → null (not "Free"), otherwise parse
                const parsedPrice = p.price === '' || p.price === null ? null : p.price;

                // Stock handling: distinguish null (unlimited/not managed) vs 0 (out of stock)
                // WooCommerce stock_status gives us: 'instock', 'outofstock', 'onbackorder'
                // stock_quantity null means "stock management disabled" (unlimited)
                // stock_quantity 0 means "stock managed and depleted"

                return prisma.wooProduct.upsert({
                    where: { accountId_wooId: { accountId, wooId: p.id } },
                    update: {
                        name: p.name,
                        sku: p.sku,
                        price: parsedPrice,
                        stockStatus: p.stock_status, // Sync from WooCommerce to distinguish states
                        stockQuantity: p.stock_quantity ?? null,
                        manageStock: p.manage_stock ?? (p as any).manage_stock ?? false,
                        permalink: p.permalink,
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
                        price: parsedPrice,
                        stockStatus: p.stock_status,
                        stockQuantity: p.stock_quantity ?? null,
                        manageStock: p.manage_stock ?? (p as any).manage_stock ?? false,
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

            // Execute upserts in chunks of 10 — prevents saturating the Prisma connection
            // pool. OrderSync and CustomerSync already use similar chunking (BATCH_SIZE=50);
            // products use 10 because each upsert carries a larger payload (images, rawData).
            const UPSERT_CHUNK = 10;
            const failedProductWooIds: number[] = [];
            for (let i = 0; i < upsertOperations.length; i += UPSERT_CHUNK) {
                const ops = upsertOperations.slice(i, i + UPSERT_CHUNK);
                const productSlice = products.slice(i, i + UPSERT_CHUNK);
                await Promise.all(ops.map((op, idx) => op.catch((err) => {
                    totalSkipped++;
                    failedProductWooIds.push(productSlice[idx].id);
                    Logger.warn('Failed to upsert product', { accountId, syncId, error: err.message });
                })));
            }

            // Preserve existing records that failed to upsert (transient DB errors)
            // so updatedAt-based reconciliation doesn't delete them
            if (failedProductWooIds.length > 0) {
                await prisma.$executeRawUnsafe(
                    `UPDATE "WooProduct" SET "updatedAt" = NOW() WHERE "accountId" = $1 AND "wooId" = ANY($2::int[])`,
                    accountId, failedProductWooIds
                );
            }

            // Batch-fetch all upserted products once (avoids N+1 queries)
            const upsertedProducts = await prisma.wooProduct.findMany({
                where: {
                    accountId,
                    wooId: { in: products.map(p => p.id) }
                }
            });
            const productMap = new Map(upsertedProducts.map(p => [p.wooId, p]));

            // Process scoring and indexing
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

            // Score/SEO updates chunked at 10 — same rationale as upserts above.
            const SCORE_CHUNK = 10;
            for (let i = 0; i < scoreUpdateOperations.length; i += SCORE_CHUNK) {
                const ops = scoreUpdateOperations.slice(i, i + SCORE_CHUNK);
                await Promise.all(ops.map(op => op.catch((err) => {
                    Logger.warn('Failed to update product scores', { accountId, syncId, error: err.message });
                })));
            }

            // Bulk index all products in one ES call
            const productsToIndex: any[] = [];
            for (let i = 0; i < products.length; i++) {
                const p = products[i];
                const upsertedProduct = productMap.get(p.id);
                const scores = scoringResults[i] || { seoScore: 0, merchantCenterScore: 0 };

                if (upsertedProduct) {
                    productsToIndex.push({ ...upsertedProduct, ...scores });
                }

                EventBus.emit(EVENTS.PRODUCT.SYNCED, { accountId, product: p });
            }

            try {
                await IndexingService.bulkIndexProducts(accountId, productsToIndex);
            } catch (error: any) {
                Logger.warn('Bulk index products failed', { accountId, syncId, error: error.message });
            }
            totalProcessed += products.length;

            // Sync variations for variable products (parallelized in batches of 5)
            const variableProducts = products.filter(p =>
                p.type === 'variable' || (p.type && p.type.includes('variable'))
            );

            const VAR_BATCH_SIZE = 5;
            for (let vi = 0; vi < variableProducts.length; vi += VAR_BATCH_SIZE) {
                const varBatch = variableProducts.slice(vi, vi + VAR_BATCH_SIZE);
                await Promise.allSettled(varBatch.map(async (varProduct) => {
                    const parentDbProduct = productMap.get(varProduct.id);
                    if (!parentDbProduct) return;

                    try {
                        const rawVariations = await woo.getProductVariations(varProduct.id);
                        const variations = safeParseVariations(rawVariations);

                        if (variations.length === 0) return;

                        // Why no variationsData on parent: each variation's full JSON is
                        // already persisted in ProductVariation.rawData. Duplicating it
                        // here doubled heap usage for variable products with many SKUs.

                        // Batch upsert variations
                        const variationOps = variations.map(v =>
                            prisma.productVariation.upsert({
                                where: { productId_wooId: { productId: parentDbProduct.id, wooId: v.id } },
                                update: {
                                    sku: v.sku || null,
                                    price: v.price ? parseFloat(v.price) : null,
                                    salePrice: v.sale_price ? parseFloat(v.sale_price) : null,
                                    stockStatus: v.stock_status,
                                    stockQuantity: v.stock_quantity ?? null,
                                    manageStock: v.manage_stock ?? (v as any).manage_stock ?? false,
                                    images: (v.image ? [v.image] : []) as any,
                                    rawData: v as any
                                },
                                create: {
                                    productId: parentDbProduct.id,
                                    wooId: v.id,
                                    sku: v.sku || null,
                                    price: v.price ? parseFloat(v.price) : null,
                                    salePrice: v.sale_price ? parseFloat(v.sale_price) : null,
                                    stockStatus: v.stock_status,
                                    stockQuantity: v.stock_quantity ?? null,
                                    manageStock: v.manage_stock ?? (v as any).manage_stock ?? false,
                                    images: (v.image ? [v.image] : []) as any,
                                    rawData: v as any
                                }
                            })
                        );

                        await Promise.all(variationOps.map(op => op.catch((err) => {
                            Logger.warn('Failed to upsert variation', { accountId, syncId, error: err.message });
                        })));
                        totalVariationsSynced += variations.length;

                        Logger.debug(`Synced ${variations.length} variations for product ${varProduct.name}`, {
                            accountId, syncId, productId: varProduct.id
                        });
                    } catch (error: any) {
                        Logger.warn(`Failed to sync variations for product ${varProduct.id}`, {
                            accountId, syncId, error: error.message
                        });
                    }
                }));
            }

            Logger.info(`Synced batch of ${products.length} products (${totalVariationsSynced} variations)`, { accountId, syncId, page, totalPages, skipped: totalSkipped });
            if (page >= totalPages) hasMore = false;

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                if (!(await job.isActive())) throw new Error('Cancelled');
            }

            page++;

            // Throttle API pagination to avoid overwhelming the WooCommerce store
            if (hasMore) await new Promise(r => setTimeout(r, 500));
        }

        // Reconciliation: remove products/variations not touched during this full sync.
        // Count-first pattern: evaluate the 30% safety cap via SQL count() rather
        // than loading every stale id/wooId into Node memory.
        if (!incremental && totalProcessed > 0) {
            const staleProductCount = await prisma.wooProduct.count({
                where: { accountId, updatedAt: { lt: syncStartedAt } }
            });

            if (staleProductCount > 0) {
                const localTotal = await prisma.wooProduct.count({ where: { accountId } });
                const maxDeletions = Math.max(10, Math.floor(localTotal * 0.3));

                if (staleProductCount > maxDeletions) {
                    Logger.warn(`Product reconciliation aborted: would delete ${staleProductCount}/${localTotal} (>30% cap)`, {
                        accountId, syncId, toDelete: staleProductCount, localTotal
                    });
                } else {
                    // Stream ES deletions in chunks so we never hold the full ID list.
                    const ES_DELETE_CHUNK = 500;
                    let cursor: string | undefined;
                    while (true) {
                        const chunk: { id: string; wooId: number }[] = await prisma.wooProduct.findMany({
                            where: { accountId, updatedAt: { lt: syncStartedAt } },
                            select: { id: true, wooId: true },
                            orderBy: { id: 'asc' },
                            take: ES_DELETE_CHUNK,
                            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
                        });
                        if (chunk.length === 0) break;
                        await Promise.allSettled(
                            chunk.map(p => IndexingService.deleteProduct(accountId, p.wooId))
                        );
                        cursor = chunk[chunk.length - 1].id;
                        if (chunk.length < ES_DELETE_CHUNK) break;
                    }

                    const { count } = await prisma.wooProduct.deleteMany({
                        where: { accountId, updatedAt: { lt: syncStartedAt } }
                    });
                    totalDeleted += count;
                    Logger.info(`Reconciliation: Deleted ${count} orphaned products`, { accountId, syncId });
                }
            }

            // Variation reconciliation: delete directly (no per-id ES calls needed,
            // variations aren't indexed in ES separately from their parent product).
            const { count: staleVarCount } = await prisma.productVariation.deleteMany({
                where: { product: { accountId }, updatedAt: { lt: syncStartedAt } }
            });
            if (staleVarCount > 0) {
                Logger.info(`Reconciliation: Deleted ${staleVarCount} orphaned variations`, { accountId, syncId });
            }
        }

        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }
}
