import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/express';
import { ProductsService } from '../services/products';
import { requireAuth } from '../middleware/auth';
import { WooService } from '../services/woo';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { SeoScoringService } from '../services/SeoScoringService';
import { MerchantCenterService } from '../services/MerchantCenterService';
import { IndexingService } from '../services/search/IndexingService';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        // Middleware guarantees accountId or returns 400

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const query = (req.query.q as string) || '';

        const result = await ProductsService.searchProducts(accountId, query, page, limit);
        res.json(result);
    } catch (error: any) {
        Logger.error('Error', { error });
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// GET /:id (Get single product by WooID)
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;

        const wooId = parseInt(req.params.id);
        if (isNaN(wooId)) return res.status(400).json({ error: 'Invalid product ID' });

        const product = await ProductsService.getProductByWooId(accountId, wooId);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        res.json(product);
    } catch (error: any) {
        Logger.error('Error', { error });
        res.status(500).json({ error: 'Failed to fetch product' });
    }
});

// POST /:id/sync (Force Sync from Woo)
router.post('/:id/sync', requireAuth, async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;
        const wooId = parseInt(req.params.id);
        if (isNaN(wooId)) return res.status(400).json({ error: 'Invalid product ID' });

        const woo = await WooService.forAccount(accountId);
        const p = await woo.getProduct(wooId);

        if (!p) return res.status(404).json({ error: 'Product not found in WooCommerce' });

        // Upsert Product
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

        // Scoring & Indexing
        const upsertedProduct = await prisma.wooProduct.findUnique({
            where: { accountId_wooId: { accountId, wooId: p.id } }
        });

        if (upsertedProduct) {
            const currentSeoData = (upsertedProduct.seoData as any) || {};
            const focusKeyword = currentSeoData.focusKeyword || '';

            const seoResult = SeoScoringService.calculateScore(upsertedProduct, focusKeyword);
            const mcResult = MerchantCenterService.validateCompliance(upsertedProduct);

            await prisma.wooProduct.update({
                where: { id: upsertedProduct.id },
                data: {
                    seoScore: seoResult.score,
                    seoData: { ...currentSeoData, analysis: seoResult.tests },
                    merchantCenterScore: mcResult.score,
                    merchantCenterIssues: mcResult.issues as any
                }
            });

            // Index
            try {
                await IndexingService.indexProduct(accountId, {
                    ...p,
                    seoScore: seoResult.score,
                    merchantCenterScore: mcResult.score
                });
            } catch (err) {
                Logger.warn("Failed to index product during manual sync", { error: err });
            }
        }

        // Return updated product via Service logic to format it correctly
        const finalProduct = await ProductsService.getProductByWooId(accountId, wooId);
        res.json(finalProduct);

    } catch (error: any) {
        Logger.error("Force Sync Error", { error });
        res.status(500).json({ error: 'Failed to sync product: ' + error.message });
    }
});

// PATCH /:id (Update product details)
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const accountId = (req as any).accountId;

        const wooId = parseInt(req.params.id);
        if (isNaN(wooId)) return res.status(400).json({ error: 'Invalid product ID' });

        const { binLocation, name, stockStatus, isGoldPriceApplied, sku, price, salePrice, weight, length, width, height, description, short_description, cogs, supplierId, images } = req.body;

        const product = await ProductsService.updateProduct(accountId, wooId, {
            binLocation, name, stockStatus, isGoldPriceApplied,
            sku, price, salePrice, weight, length, width, height, description, short_description,
            cogs, supplierId, images
        });
        res.json(product);
    } catch (error: any) {
        Logger.error('Error', { error });
        res.status(500).json({ error: 'Failed to update product' });
    }
});

export default router;
