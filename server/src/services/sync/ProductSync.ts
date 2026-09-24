import { BaseSync, SyncResult } from './BaseSync';
import { needsWooVariationListing, persistWooProduct } from '../persistWooProduct';
import { isWooProductNotFound, trashWooProduct } from '../productDeletion';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
import { IndexingService } from '../search/IndexingService';
import { SeoScoringService } from '../SeoScoringService';
import { MerchantCenterService } from '../MerchantCenterService';
import { EmbeddingService } from '../EmbeddingService';
import { EventBus, EVENTS } from '../events';
import { Logger } from '../../utils/logger';
import { parseWooDate } from '../../utils/wooDates';
import { WooProductSchema, WooProduct } from './wooSchemas';
import { reconcileWholesaleProductsBestEffort } from '../wholesale/reconciliation';


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
        let validationFailures = 0;
        let totalUpsertFailures = 0;
        let variationFailures = 0;
        let variationValidationFailures = 0;
        let totalVariationsSynced = 0;
        const wholesaleReconciliationProductIds = new Set<string>();

        const syncStartedAt = new Date();
        const seenProductIds = new Set<number>();
        let expectedProductTotal: number | undefined;
        let expectedProductPages: number | undefined;

        while (hasMore) {
            const { data: rawProducts, totalPages, total } = await woo.getProducts({ page, after, per_page: 50, status: 'any', context: 'edit' });
            if (!Array.isArray(rawProducts)) throw new Error('Invalid Woo product listing');
            if (totalPages > 0) {
                if (expectedProductPages !== undefined && expectedProductPages !== totalPages) throw new Error('Woo product pagination changed');
                expectedProductPages = totalPages;
            }
            if (total > 0) {
                if (expectedProductTotal !== undefined && expectedProductTotal !== total) throw new Error('Woo product total changed');
                expectedProductTotal = total;
            }
            if (!rawProducts.length) {
                if (expectedProductPages !== undefined && page <= expectedProductPages && (page > 1 || expectedProductPages > 1)) throw new Error('Incomplete Woo product listing');
                hasMore = false;
                break;
            }

            // Validate products with Zod schema, skip invalid ones
            const products: WooProduct[] = [];
            for (const raw of rawProducts) {
                if (Number.isSafeInteger(raw?.id) && raw.id > 0) {
                    if (seenProductIds.has(raw.id)) throw new Error('Woo product pagination repeated ID');
                    seenProductIds.add(raw.id);
                }
                if (raw?.status === 'trash' && Number.isSafeInteger(raw.id) && raw.id > 0) {
                    await trashWooProduct(accountId, raw.id);
                    continue;
                }
                const result = WooProductSchema.safeParse(raw);
                if (result.success) {
                    products.push(result.data);
                } else {
                    totalSkipped++;
                    validationFailures++;
                    Logger.debug(`Skipping invalid product`, {
                        accountId, syncId, productId: raw?.id,
                        errors: result.error.issues.map(i => i.message).slice(0, 3)
                    });
                }
            }

            if (!products.length) {
                hasMore = this.hasMorePages(page, totalPages, rawProducts.length, 50);
                if (job) {
                    const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : (hasMore ? 0 : 100);
                    await job.updateProgress(progress);
                    await this.assertNotCancelled(job);
                }
                page++;
                if (hasMore) await new Promise(r => setTimeout(r, 500));
                continue;
            }

            const acceptedWooIds = new Set<number>();
            // Prepare complete per-parent observations before taking any DB lock.
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

                // COGS is Overseek-owned: remote native COGS stays in rawData only.
                // Never hydrate the local cogs column, including on initial import.
                return async () => {
                    const rawVariations = needsWooVariationListing(p.type, p)
                        ? await woo.getProductVariations(p.id, { bypassCache: true }) : undefined;
                    const result = await persistWooProduct(p.type, {
                        where: { accountId_wooId: { accountId, wooId: p.id } },
                        update: {
                            name: p.name,
                            sku: p.sku,
                            status: p.status || null,
                            catalogVisibility: p.catalog_visibility || 'visible',
                            dateCreated: parseWooDate(p.date_created_gmt || p.date_created),
                            price: parsedPrice,
                            stockStatus: p.stock_status,
                            stockQuantity: p.stock_quantity ?? null,
                            manageStock: p.manage_stock ?? false,
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
                            status: p.status || null,
                            catalogVisibility: p.catalog_visibility || 'visible',
                            dateCreated: parseWooDate(p.date_created_gmt || p.date_created),
                            price: parsedPrice,
                            stockStatus: p.stock_status,
                            stockQuantity: p.stock_quantity ?? null,
                            manageStock: p.manage_stock ?? false,
                            permalink: p.permalink,
                            mainImage: p.images?.[0]?.src,
                            weight: p.weight ? parseFloat(p.weight) : null,
                            length: p.dimensions?.length ? parseFloat(p.dimensions.length) : null,
                            width: p.dimensions?.width ? parseFloat(p.dimensions.width) : null,
                            height: p.dimensions?.height ? parseFloat(p.dimensions.height) : null,
                            images: (p.images || []) as any,
                            rawData: p as any
                        }
                    }, syncStartedAt, rawVariations);
                    if (result.accepted === false) {
                        totalSkipped++;
                        if (result.reason === 'quarantined_variations') {
                            variationValidationFailures += result.failures!.length;
                            Logger.warn('Quarantined WooCommerce parent snapshot; no source changes applied', {
                                accountId, syncId, productId: p.id, invalidCount: result.failures!.length, failures: result.failures,
                            });
                        } else if (result.reason === 'incomplete_product') {
                            validationFailures++;
                            Logger.warn('Quarantined incomplete WooCommerce product snapshot', { accountId, syncId, productId: p.id });
                        } else if (result.reason !== 'stale') {
                            variationFailures++;
                            Logger.warn('Deferred incomplete WooCommerce parent snapshot', { accountId, syncId, productId: p.id, reason: result.reason });
                        }
                        return;
                    }
                    acceptedWooIds.add(p.id);
                    totalVariationsSynced += result.variationsSynced;
                };
            });

            // Bound concurrent Woo enumerations and retained per-parent snapshots.
            const UPSERT_CHUNK = 2;
            for (let i = 0; i < upsertOperations.length; i += UPSERT_CHUNK) {
                const ops = upsertOperations.slice(i, i + UPSERT_CHUNK);
                await Promise.all(ops.map(op => op().catch((err) => {
                    totalSkipped++;
                    totalUpsertFailures++;
                    Logger.warn('Failed to apply WooCommerce product observation', { accountId, syncId, error: err.message });
                })));
            }

            // Rejected, quarantined and failed observations have ZERO source writes,
            // including bookkeeping timestamps. Never score/index/emit them as saved.
            const persistedProducts = products.filter(product => acceptedWooIds.has(product.id));

            // Batch-fetch all upserted products once (avoids N+1 queries)
            const upsertedProducts = persistedProducts.length ? await prisma.wooProduct.findMany({
                where: {
                    accountId,
                    wooId: { in: persistedProducts.map(p => p.id) }
                }
            }) : [];
            const productMap = new Map(upsertedProducts.map(p => [p.wooId, p]));
            upsertedProducts.forEach(product => wholesaleReconciliationProductIds.add(product.id));

            // Process scoring and indexing
            const scoringResults: { seoScore: number; merchantCenterScore: number }[] = [];

            // Score products and batch-collect update operations
            const scoreUpdateOperations = [];
            for (const p of persistedProducts) {
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
            for (let i = 0; i < persistedProducts.length; i++) {
                const p = persistedProducts[i];
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
                // Indexing can also remove rows trashed concurrently. Never advance
                // the checkpoint past a failed search deletion.
                throw error;
            }
            totalProcessed += persistedProducts.length;

            Logger.info(`Synced batch of ${persistedProducts.length} products (${totalVariationsSynced} variations)`, { accountId, syncId, page, totalPages, skipped: totalSkipped });
            hasMore = this.hasMorePages(page, totalPages, rawProducts.length, 50);

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                await this.assertNotCancelled(job);
            }

            page++;

            // Throttle API pagination to avoid overwhelming the WooCommerce store
            if (hasMore) await new Promise(r => setTimeout(r, 500));
        }

        if (expectedProductTotal !== undefined && seenProductIds.size !== expectedProductTotal && validationFailures === 0) {
            throw new Error('Incomplete Woo product total; checkpoint was not advanced.');
        }
        if (totalUpsertFailures > 0) {
            throw new Error(`Product sync could not persist ${totalUpsertFailures} product(s); checkpoint was not advanced.`);
        }
        if (variationFailures > 0) {
            throw new Error(`Product sync could not fully persist ${variationFailures} variation payload(s); checkpoint was not advanced.`);
        }
        if (variationValidationFailures > 0) {
            Logger.warn('Product sync completed with quarantined variation payloads', {
                accountId,
                syncId,
                invalidVariationCount: variationValidationFailures
            });
        }

        // Scan trash first, including during incremental sync. Only explicit status
        // is authoritative; a store ignoring the status filter must not trash live rows.
        let trashPage = 1;
        while (true) {
            const { data: trashedProducts, totalPages } = await woo.getProducts({ page: trashPage, per_page: 100, status: 'trash' });
            for (const product of trashedProducts) {
                if (product.status === 'trash' && Number.isSafeInteger(product.id) && product.id > 0) {
                    await trashWooProduct(accountId, product.id);
                }
            }
            if (!trashedProducts.length || !this.hasMorePages(trashPage, totalPages, trashedProducts.length, 100)) break;
            trashPage++;
        }

        // Missing-product diagnostics only. Timestamps identify lookup candidates,
        // never deletion evidence. Bound the scan before loading IDs into memory.
        if (!incremental && validationFailures === 0) {
            const staleProductCount = await prisma.wooProduct.count({
                where: { accountId, updatedAt: { lt: syncStartedAt } }
            });

            if (staleProductCount > 0) {
                const localTotal = await prisma.wooProduct.count({ where: { accountId } });
                const maxDeletions = Math.max(10, Math.floor(localTotal * 0.3));

                if (staleProductCount > maxDeletions) {
                    Logger.warn(`Product reconciliation lookup deferred: ${staleProductCount}/${localTotal} stale candidates (>30% cap)`, {
                        accountId, syncId, toDelete: staleProductCount, localTotal
                    });
                } else {
                    // List absence alone is not proof of deletion (trash, permissions,
                    // pagination). Confirm each candidate with an uncached product GET.
                    const DELETE_CHUNK = 500;
                    let cursor: string | undefined;
                    while (true) {
                        const chunk: { id: string; wooId: number }[] = await prisma.wooProduct.findMany({
                            where: { accountId, updatedAt: { lt: syncStartedAt }, ...(cursor ? { id: { gt: cursor } } : {}) },
                            select: { id: true, wooId: true },
                            orderBy: { id: 'asc' },
                            take: DELETE_CHUNK
                        });
                        if (chunk.length === 0) break;
                        for (const candidate of chunk) {
                            let remote;
                            try {
                                remote = await woo.getProduct(candidate.wooId, { bypassCache: true });
                            } catch (error) {
                                if (!isWooProductNotFound(error)) throw error;
                                // No safe product tombstone exists. Hard deletion cascades
                                // recipes and detaches purchase orders; retain the row until
                                // a lifecycle-aware archival design is implemented.
                                Logger.warn('Confirmed missing Woo product retained: catalogue retirement required', {
                                    accountId, productId: candidate.wooId,
                                    code: 'woocommerce_rest_product_invalid_id',
                                });
                                continue;
                            }
                            if (remote?.id === candidate.wooId && remote.status === 'trash') await trashWooProduct(accountId, candidate.wooId);
                        }
                        cursor = chunk[chunk.length - 1].id;
                        if (chunk.length < DELETE_CHUNK) break;
                    }

                    Logger.info('Completed missing-product lookups; historical records retained', { accountId, syncId });
                }
            }

        }

        await reconcileWholesaleProductsBestEffort(accountId, [...wholesaleReconciliationProductIds]);

        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }
}
