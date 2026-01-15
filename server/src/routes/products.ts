/**
 * Products Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { ProductsService } from '../services/products';
import { requireAuthFastify } from '../middleware/auth';
import { WooService } from '../services/woo';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { SeoScoringService } from '../services/SeoScoringService';
import { MerchantCenterService } from '../services/MerchantCenterService';
import { IndexingService } from '../services/search/IndexingService';
import { esClient } from '../utils/elastic';
import { marked } from 'marked';
import { z } from 'zod';
import { REVENUE_STATUSES } from '../constants/orderStatus';

const searchQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    q: z.string().optional().default('')
});

const productIdParamSchema = z.object({
    id: z.coerce.number().int().positive()
});

const updateProductBodySchema = z.object({
    binLocation: z.string().optional(),
    name: z.string().optional(),
    stockStatus: z.string().optional(),
    isGoldPriceApplied: z.boolean().optional(),
    goldPriceType: z.string().nullable().optional(),
    sku: z.string().optional(),
    price: z.union([z.string(), z.number()]).transform(val => String(val)).optional(),
    salePrice: z.union([z.string(), z.number()]).transform(val => String(val)).optional(),
    weight: z.union([z.string(), z.number()]).optional(),
    length: z.union([z.string(), z.number()]).optional(),
    width: z.union([z.string(), z.number()]).optional(),
    height: z.union([z.string(), z.number()]).optional(),
    description: z.string().optional(),
    short_description: z.string().optional(),
    cogs: z.union([z.string(), z.number()]).transform(val => val === '' ? undefined : Number(val)).optional(),
    supplierId: z.string().optional(),
    images: z.array(z.any()).optional(),
    focusKeyword: z.string().optional(),
    variations: z.array(z.any()).optional()
});

const createProductBodySchema = z.object({
    name: z.string().min(1)
});

const rewriteDescriptionBodySchema = z.object({
    currentDescription: z.string().optional(),
    productName: z.string().optional(),
    categories: z.string().optional(),
    shortDescription: z.string().optional()
});

const productsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // GET / - Search products
    fastify.get('/', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { page, limit, q } = searchQuerySchema.parse(request.query);

            const result = await ProductsService.searchProducts(accountId, q, page, limit);
            return result;
        } catch (error: any) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch products' });
        }
    });
    // POST / - Create product (Currently disabled - products should be created in WooCommerce)
    fastify.post('/', async (_request, reply) => {
        return reply.code(501).send({ error: 'Product creation not yet implemented. Please create products in WooCommerce directly.' });
    });

    // GET /:id - Get single product
    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { id: wooId } = productIdParamSchema.parse(request.params);

            const product = await ProductsService.getProductByWooId(accountId, wooId);
            if (!product) return reply.code(404).send({ error: 'Product not found' });

            return product;
        } catch (error: any) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch product' });
        }
    });

    // POST /:id/sync - Force sync from Woo
    fastify.post<{ Params: { id: string } }>('/:id/sync', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { id: wooId } = productIdParamSchema.parse(request.params);

            const woo = await WooService.forAccount(accountId);
            const p = await woo.getProduct(wooId);

            if (!p) return reply.code(404).send({ error: 'Product not found in WooCommerce' });

            // For variable products, fetch full variation data
            let variationsData: any[] = [];
            if (p.type === 'variable' && p.variations?.length > 0) {
                variationsData = await woo.getProductVariations(wooId);
                Logger.info(`Fetched ${variationsData.length} variations for product ${wooId}`);
            }

            // Store rawData with variationsData included
            const rawDataWithVariations = {
                ...p,
                variationsData
            };

            await prisma.wooProduct.upsert({
                where: { accountId_wooId: { accountId, wooId: p.id } },
                update: {
                    name: p.name,
                    price: p.price === '' ? null : p.price,
                    stockStatus: p.stock_status,
                    rawData: rawDataWithVariations as any,
                    mainImage: p.images?.[0]?.src,
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
                    weight: p.weight ? parseFloat(p.weight) : null,
                    length: p.dimensions?.length ? parseFloat(p.dimensions.length) : null,
                    width: p.dimensions?.width ? parseFloat(p.dimensions.width) : null,
                    height: p.dimensions?.height ? parseFloat(p.dimensions.height) : null,
                    images: p.images || [],
                    rawData: rawDataWithVariations as any
                }
            });


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

            const finalProduct = await ProductsService.getProductByWooId(accountId, wooId);
            return finalProduct;

        } catch (error: any) {
            Logger.error("Force Sync Error", { error });
            return reply.code(500).send({ error: 'Failed to sync product: ' + error.message });
        }
    });

    // PATCH /:id - Update product
    fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { id: wooId } = productIdParamSchema.parse(request.params);
            const { binLocation, name, stockStatus, isGoldPriceApplied, goldPriceType, sku, price, salePrice, weight, length, width, height, description, short_description, cogs, supplierId, images, focusKeyword, variations } = updateProductBodySchema.parse(request.body);

            let product = await ProductsService.updateProduct(accountId, wooId, {
                binLocation, name, stockStatus, isGoldPriceApplied, goldPriceType,
                sku, price, salePrice, weight, length, width, height, description, short_description,
                cogs, supplierId, images, variations
            });

            // Recalculate SEO if needed
            // We use the updated product data plus the focus keyword from body (or existing)
            // Ideally we need to fetch the fresh product to get everything
            const freshProduct = await ProductsService.getProductByWooId(accountId, wooId);

            if (freshProduct) {
                // If focusKeyword is passed, we might want to save it somewhere? 
                // Currently it seems to be in seoData json blob in prisma.
                // We should update that first if it changed.

                const currentSeoData = (product.seoData as any) || {};
                const kw = focusKeyword !== undefined ? focusKeyword : (currentSeoData.focusKeyword || '');

                const seoResult = SeoScoringService.calculateScore(freshProduct, kw);
                const mcResult = MerchantCenterService.validateCompliance(freshProduct);

                // Update scores in DB
                await prisma.wooProduct.update({
                    where: { id: product.id },
                    data: {
                        seoScore: seoResult.score,
                        seoData: { ...currentSeoData, focusKeyword: kw, analysis: seoResult.tests },
                        merchantCenterScore: mcResult.score,
                        merchantCenterIssues: mcResult.issues as any
                    }
                });

                // Re-fetch to return with new scores
                product = (await ProductsService.getProductByWooId(accountId, wooId))!;

                // Re-index
                try {
                    await IndexingService.indexProduct(accountId, {
                        ...product,
                        seoScore: seoResult.score,
                        merchantCenterScore: mcResult.score
                    });
                } catch (err) {
                    Logger.warn("Failed to re-index product after update", { error: err });
                }
            }

            return product;
        } catch (error: any) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to update product' });
        }
    });

    // GET /:id/sales-history - Get sales history from Elasticsearch
    fastify.get<{ Params: { id: string } }>('/:id/sales-history', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { id: wooId } = productIdParamSchema.parse(request.params);
            const { page, limit } = searchQuerySchema.parse(request.query);
            const from = (page - 1) * limit;

            const response = await esClient.search({
                index: 'orders',
                size: limit,
                from,
                query: {
                    bool: {
                        must: [
                            { term: { accountId } },
                            {
                                nested: {
                                    path: 'line_items',
                                    query: { term: { 'line_items.productId': wooId } },
                                    inner_hits: { name: 'matched_items', size: 10 }
                                }
                            }
                        ],
                        filter: [
                            { terms: { status: REVENUE_STATUSES } }
                        ]
                    }
                },
                sort: [{ date_created: { order: 'desc' } } as any]
            });

            const hits = response.hits.hits;
            const total = typeof response.hits.total === 'number'
                ? response.hits.total
                : response.hits.total?.value || 0;

            const sales = hits.map((hit: any) => {
                const order = hit._source;
                const matchedItems = hit.inner_hits?.matched_items?.hits?.hits || [];
                let quantity = 0;
                let lineTotal = 0;

                matchedItems.forEach((itemHit: any) => {
                    const item = itemHit._source;
                    quantity += item.quantity || 0;
                    lineTotal += parseFloat(item.total) || 0;
                });

                return {
                    orderId: order.id,
                    orderNumber: order.number || `#${order.id}`,
                    date: order.date_created,
                    status: order.status,
                    customerName: order.billing
                        ? `${order.billing.first_name || ''} ${order.billing.last_name || ''}`.trim() || order.billing.email
                        : 'Guest',
                    customerEmail: order.billing?.email,
                    quantity,
                    lineTotal,
                    orderTotal: parseFloat(order.total) || 0,
                    currency: order.currency || 'USD'
                };
            });

            return {
                sales,
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            };

        } catch (error: any) {
            Logger.error('Error fetching product sales history', { error });
            return reply.code(500).send({ error: 'Failed to fetch sales history' });
        }
    });

    // POST /:id/rewrite-description - AI rewrite
    fastify.post<{ Params: { id: string } }>('/:id/rewrite-description', async (request, reply) => {
        try {
            const accountId = request.accountId!;
            const { id: wooId } = productIdParamSchema.parse(request.params);
            const { currentDescription, productName, categories, shortDescription } = rewriteDescriptionBodySchema.parse(request.body);

            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { openRouterApiKey: true, aiModel: true }
            });

            if (!account?.openRouterApiKey) {
                return reply.code(400).send({
                    error: 'No OpenRouter API key configured. Please add your API key in Settings > AI.'
                });
            }

            const promptConfig = await prisma.aIPrompt.findUnique({
                where: { promptId: 'product_description' }
            });


            const defaultPrompt = `Rewrite the following product description to be more engaging, SEO-friendly, and persuasive. 
            Product Name: {{product_name}}
            Current Categories: {{category}}
            Short Description: {{short_description}}
            
            Current Description:
            {{current_description}}
            
            Return ONLY the rewritten description in Markdown format. Do not include any conversational preamble.`;

            let promptContent = promptConfig?.content || defaultPrompt;

            let prompt = promptContent
                .replace(/\{\{product_name\}\}/g, productName || '')
                .replace(/\{\{current_description\}\}/g, currentDescription || '')
                .replace(/\{\{short_description\}\}/g, shortDescription || '')
                .replace(/\{\{category\}\}/g, categories || '');

            const model = account.aiModel || 'openai/gpt-4o';

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${account.openRouterApiKey}`,
                    'HTTP-Referer': 'https://overseek.app',
                    'X-Title': 'OverSeek Product Rewrite',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 2000,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                Logger.error('OpenRouter API error during rewrite', { error: errorText, status: response.status });

                let errorMessage = 'Failed to generate description.';
                if (response.status === 401) {
                    errorMessage = 'Invalid OpenRouter API key. Please check your credentials in Settings > Intelligence.';
                } else if (response.status === 429) {
                    errorMessage = 'Rate limit exceeded. Please try again in a moment.';
                } else if (response.status === 402) {
                    errorMessage = 'Insufficient credits on OpenRouter. Please top up your account.';
                } else {
                    errorMessage = `OpenRouter API error (${response.status}). Please try again.`;
                }

                return reply.code(502).send({ error: errorMessage });
            }

            const data = await response.json();
            const generatedDescription = data.choices?.[0]?.message?.content || '';

            if (!generatedDescription) {
                return reply.code(500).send({ error: 'AI returned empty response' });
            }

            const formattedDescription = marked.parse(generatedDescription.trim()) as string;

            return { description: formattedDescription };

        } catch (error: any) {
            Logger.error('Error rewriting product description', { error });
            return reply.code(500).send({ error: 'Failed to rewrite description' });
        }
    });
};

export default productsRoutes;
