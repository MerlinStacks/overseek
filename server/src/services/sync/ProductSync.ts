import { BaseSync } from './BaseSync';
import { WooService } from '../woo';
import { PrismaClient } from '@prisma/client';
import { IndexingService } from '../search/IndexingService';
import { SeoScoringService } from '../SeoScoringService';
import { MerchantCenterService } from '../MerchantCenterService';
import { EmbeddingService } from '../EmbeddingService';
import { EventBus, EVENTS } from '../events';
import { Logger } from '../../utils/logger';

const prisma = new PrismaClient();

export class ProductSync extends BaseSync {
    protected entityType = 'products';

    protected async sync(woo: WooService, accountId: string, incremental: boolean, job?: any): Promise<void> {
        // Products don't reliably support 'after' in all Woo versions via this wrapper, but we'll try
        // or just fetch key pages.
        const after = incremental ? await this.getLastSync(accountId) : undefined;
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;

        while (hasMore) {
            const { data: products, totalPages } = await woo.getProducts({ page, after, per_page: 50 });
            if (!products.length) {
                hasMore = false;
                break;
            }

            for (const p of products) {
                await prisma.wooProduct.upsert({
                    where: { accountId_wooId: { accountId, wooId: p.id } },
                    update: {
                        name: p.name,
                        price: p.price === '' ? null : p.price,
                        stockStatus: p.stock_status,
                        rawData: p as any,
                        mainImage: p.images?.[0]?.src,
                        // @ts-ignore - TS2353: Persistent Docker build error masking this field
                        weight: p.weight ? parseFloat(p.weight) : null,
                        length: p.dimensions?.length ? parseFloat(p.dimensions.length) : null,
                        width: p.dimensions?.width ? parseFloat(p.dimensions.width) : null,
                        height: p.dimensions?.height ? parseFloat(p.dimensions.height) : null,
                        images: p.images || []
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
                        // @ts-ignore - TS2353: Persistent Docker build error masking this field
                        weight: p.weight ? parseFloat(p.weight) : null,
                        length: p.dimensions?.length ? parseFloat(p.dimensions.length) : null,
                        width: p.dimensions?.width ? parseFloat(p.dimensions.width) : null,
                        height: p.dimensions?.height ? parseFloat(p.dimensions.height) : null,
                        images: p.images || [],
                        rawData: p as any
                    }
                });

                // --- Scoring Logic ---
                // Fetch fresh for clean state
                const upsertedProduct = await prisma.wooProduct.findUnique({
                    where: { accountId_wooId: { accountId, wooId: p.id } }
                });

                let seoScore = 0;
                let merchantCenterScore = 0;

                if (upsertedProduct) {
                    const currentSeoData = (upsertedProduct.seoData as any) || {};
                    const focusKeyword = currentSeoData.focusKeyword || '';

                    const seoResult = SeoScoringService.calculateScore(upsertedProduct, focusKeyword);
                    const mcResult = MerchantCenterService.validateCompliance(upsertedProduct);

                    seoScore = seoResult.score;
                    merchantCenterScore = mcResult.score;

                    await prisma.wooProduct.update({
                        where: { id: upsertedProduct.id },
                        data: {
                            seoScore: seoResult.score,
                            seoData: { ...currentSeoData, analysis: seoResult.tests },
                            merchantCenterScore: mcResult.score,
                            merchantCenterIssues: mcResult.issues as any
                        }
                    });

                    // Generate embedding for semantic search (async, non-blocking)
                    EmbeddingService.updateProductEmbedding(upsertedProduct.id, accountId)
                        .catch((err: any) => Logger.debug('Embedding generation skipped', { productId: upsertedProduct.id, reason: err.message }));
                }

                // Index
                try {
                    await IndexingService.indexProduct(accountId, { ...p, seoScore, merchantCenterScore });
                } catch (error: any) {
                    Logger.warn(`Failed to index product ${p.id}`, { accountId, error: error.message });
                }

                // Emit Event
                EventBus.emit(EVENTS.PRODUCT.SYNCED, { accountId, product: p });

                totalProcessed++;
            }

            Logger.info(`Synced batch of ${products.length} products`, { accountId, page, totalPages });
            if (products.length < 50) hasMore = false;

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                if (!(await job.isActive())) throw new Error('Cancelled');
            }

            page++;
        }

        Logger.info(`Product Sync Complete. Total: ${totalProcessed}`, { accountId });
    }
}
