/**
 * Ad Copy Generation Routes
 * 
 * REST endpoints for AI-powered ad copy generation.
 * Part of AI Co-Pilot v2 Phase 1.
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';
import {
    AdCopyGenerator,
    AdCopyContext,
    BulkGenerationOptions,
    TonePreset,
    AdPlatform
} from '../../services/tools/AdCopyGenerator';
import { prisma } from '../../utils/prisma';

// =============================================================================
// TYPES
// =============================================================================

interface GenerateCopyBody {
    productId?: string;
    productName?: string;
    tonePreset?: TonePreset;
    platform?: AdPlatform;
    customContext?: Partial<AdCopyContext>;
}

interface BulkGenerateBody {
    tonePreset: TonePreset;
    platform: AdPlatform;
    productIds?: string[];
    maxProducts?: number;
}

// =============================================================================
// ROUTES
// =============================================================================

export const adCopyRoutes: FastifyPluginAsync = async (fastify) => {

    // Apply auth to all routes
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * POST /api/ads/copy/generate
     * Generate ad copy for a single product or store context
     */
    fastify.post<{ Body: GenerateCopyBody }>('/generate', async (request, reply) => {
        const user = (request as any).user;
        const accountId = user.accountId;
        const { productId, productName, tonePreset, platform, customContext } = request.body;

        try {
            let context: AdCopyContext;

            if (productId) {
                // Generate for specific product
                const product = await prisma.wooProduct.findFirst({
                    where: { id: productId, accountId }
                });

                if (!product) {
                    return reply.status(404).send({
                        success: false,
                        error: 'Product not found'
                    });
                }

                const account = await prisma.account.findUnique({
                    where: { id: accountId },
                    select: { name: true, wooUrl: true }
                });

                context = {
                    storeName: account?.name || 'Store',
                    storeUrl: account?.wooUrl || '',
                    topProducts: [{
                        name: product.name,
                        price: product.price ? parseFloat(product.price.toString()) : undefined,
                        sku: product.sku || undefined
                    }],
                    avgOrderValue: product.price ? parseFloat(product.price.toString()) : 50,
                    tonePreset: tonePreset || 'professional',
                    platform: platform || 'google',
                    ...customContext
                };
            } else if (productName) {
                // Generate for a product name (without database lookup)
                const account = await prisma.account.findUnique({
                    where: { id: accountId },
                    select: { name: true, wooUrl: true }
                });

                context = {
                    storeName: account?.name || 'Store',
                    storeUrl: account?.wooUrl || '',
                    topProducts: [{ name: productName }],
                    avgOrderValue: 50,
                    tonePreset: tonePreset || 'professional',
                    platform: platform || 'google',
                    ...customContext
                };
            } else {
                // Generate for store (using top products)
                const account = await prisma.account.findUnique({
                    where: { id: accountId },
                    select: { name: true, wooUrl: true }
                });

                const topProducts = await prisma.wooProduct.findMany({
                    where: { accountId },
                    select: { name: true, price: true, sku: true },
                    orderBy: { updatedAt: 'desc' },
                    take: 5
                });

                context = {
                    storeName: account?.name || 'Store',
                    storeUrl: account?.wooUrl || '',
                    topProducts: topProducts.map(p => ({
                        name: p.name,
                        price: p.price ? parseFloat(p.price.toString()) : undefined,
                        sku: p.sku || undefined
                    })),
                    avgOrderValue: 50,
                    tonePreset: tonePreset || 'professional',
                    platform: platform || 'google',
                    ...customContext
                };
            }

            // Generate based on platform
            let result;
            if (platform === 'meta') {
                result = await AdCopyGenerator.generateForMeta(accountId, context);
            } else if (platform === 'both') {
                result = await AdCopyGenerator.generateForBothPlatforms(accountId, context);
            } else {
                result = await AdCopyGenerator.generate(accountId, context);
            }

            Logger.info('Ad copy generated', {
                accountId,
                productId,
                platform,
                tonePreset,
                source: result.source
            });

            return reply.send({
                success: true,
                data: result
            });

        } catch (error) {
            Logger.error('Ad copy generation failed', { error, accountId });
            return reply.status(500).send({
                success: false,
                error: 'Failed to generate ad copy'
            });
        }
    });

    /**
     * POST /api/ads/copy/bulk-generate
     * Bulk generate ad copy for multiple products
     */
    fastify.post<{ Body: BulkGenerateBody }>('/bulk-generate', async (request, reply) => {
        const user = (request as any).user;
        const accountId = user.accountId;
        const { tonePreset, platform, productIds, maxProducts } = request.body;

        if (!tonePreset || !platform) {
            return reply.status(400).send({
                success: false,
                error: 'tonePreset and platform are required'
            });
        }

        try {
            const options: BulkGenerationOptions = {
                tonePreset,
                platform,
                productIds,
                maxProducts: Math.min(maxProducts || 50, 100) // Cap at 100
            };

            const result = await AdCopyGenerator.generateBulk(accountId, options);

            Logger.info('Bulk ad copy generation complete', {
                accountId,
                total: result.totalProducts,
                success: result.successCount,
                failed: result.failedCount
            });

            return reply.send({
                success: true,
                data: result
            });

        } catch (error) {
            Logger.error('Bulk ad copy generation failed', { error, accountId });
            return reply.status(500).send({
                success: false,
                error: 'Failed to generate bulk ad copy'
            });
        }
    });

    /**
     * GET /api/ads/copy/tone-presets
     * Get available tone presets with descriptions
     */
    fastify.get('/tone-presets', async (request, reply) => {
        return reply.send({
            success: true,
            data: [
                {
                    id: 'professional',
                    name: 'Professional',
                    description: 'Formal, trustworthy language emphasizing quality and reliability'
                },
                {
                    id: 'playful',
                    name: 'Playful',
                    description: 'Casual, friendly language with personality and humor'
                },
                {
                    id: 'urgent',
                    name: 'Urgent',
                    description: 'Action-oriented language creating urgency and scarcity'
                },
                {
                    id: 'luxury',
                    name: 'Luxury',
                    description: 'Sophisticated, elegant language emphasizing exclusivity'
                }
            ]
        });
    });

    /**
     * GET /api/ads/copy/platforms
     * Get available platforms with limits
     */
    fastify.get('/platforms', async (request, reply) => {
        return reply.send({
            success: true,
            data: [
                {
                    id: 'google',
                    name: 'Google Ads',
                    limits: {
                        headline: 30,
                        description: 90,
                        headlineCount: 15,
                        descriptionCount: 4
                    }
                },
                {
                    id: 'meta',
                    name: 'Meta Ads (Facebook/Instagram)',
                    limits: {
                        primaryText: 125,
                        headline: 40,
                        description: 30,
                        primaryTextCount: 3,
                        headlineCount: 5
                    }
                },
                {
                    id: 'both',
                    name: 'Both Platforms',
                    description: 'Generate copy optimized for both Google and Meta'
                }
            ]
        });
    });
};

export default adCopyRoutes;
