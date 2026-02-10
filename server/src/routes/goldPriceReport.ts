/**
 * Gold Price Report Routes - Fastify Plugin
 * 
 * Provides endpoints for gold price margin analysis reports.
 * Shows products/variants with gold price enabled, sorted by profit margin.
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { requireAuthFastify } from '../middleware/auth';
import {
    calculateGoldCogs,
    calculateMargin,
    parseAccountGoldPrices,
    AccountGoldPrices
} from '../utils/goldPriceCalculations';
import { sumMiscCosts } from '../utils/miscCosts';

/** Default and max page sizes for pagination */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** Query params schema for margin report */
const marginQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
});

interface GoldPriceProduct {
    id: string;
    wooId: number;
    parentWooId?: number;
    name: string;
    variantName?: string;
    sku?: string;
    price: number;
    goldCogs: number;
    profitMargin: number;
    goldPriceType?: string;
    weight?: number;
    mainImage?: string;
    isVariant: boolean;
}

/**
 * Extracts variant name from WooCommerce rawData attributes.
 */
function extractVariantName(rawData: unknown, fallbackId: number): string {
    const data = rawData as { attributes?: { option: string }[] } | undefined;
    const attributes = data?.attributes || [];
    return attributes.map(a => a.option).join(' / ') || `Variant ${fallbackId}`;
}

const goldPriceReportRoutes: FastifyPluginAsync = async (fastify) => {
    // Pre-handler for auth
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * GET /api/reports/gold-price/margin
     * 
     * Returns gold price enabled products/variants sorted by profit margin (lowest first).
     * Supports pagination via `page` and `limit` query params.
     */
    fastify.get('/gold-price/margin', async (request, reply) => {
        const accountId = (request.headers['x-account-id'] as string) || (request as any).accountId;
        if (!accountId) {
            return reply.status(400).send({ error: 'Account ID required' });
        }

        // Parse pagination params
        const { page, limit } = marginQuerySchema.parse(request.query);

        // Fetch account gold prices
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: {
                goldPrice18ct: true,
                goldPrice9ct: true,
                goldPrice18ctWhite: true,
                goldPrice9ctWhite: true
            }
        });

        if (!account) {
            return reply.status(404).send({ error: 'Account not found' });
        }

        const accountPrices = parseAccountGoldPrices(account);

        // Fetch products with gold price enabled
        const products = await prisma.wooProduct.findMany({
            where: {
                accountId,
                isGoldPriceApplied: true
            },
            select: {
                id: true,
                wooId: true,
                name: true,
                sku: true,
                price: true,
                weight: true,
                goldPriceType: true,
                miscCosts: true,
                mainImage: true
            }
        });

        // Fetch variations with gold price enabled
        const variations = await prisma.productVariation.findMany({
            where: {
                product: { accountId },
                isGoldPriceApplied: true
            },
            select: {
                id: true,
                wooId: true,
                sku: true,
                price: true,
                weight: true,
                goldPriceType: true,
                miscCosts: true,
                rawData: true,
                product: {
                    select: {
                        wooId: true,
                        name: true,
                        mainImage: true
                    }
                }
            }
        });

        const results: GoldPriceProduct[] = [];

        // Process products
        for (const p of products) {
            const baseGoldCogs = calculateGoldCogs(
                Number(p.weight) || 0,
                p.goldPriceType,
                accountPrices
            );
            const goldCogs = baseGoldCogs + sumMiscCosts(p.miscCosts);
            const price = Number(p.price) || 0;
            const profitMargin = calculateMargin(price, goldCogs);

            results.push({
                id: p.id,
                wooId: p.wooId,
                name: p.name,
                sku: p.sku || undefined,
                price,
                goldCogs,
                profitMargin,
                goldPriceType: p.goldPriceType || undefined,
                weight: Number(p.weight) || undefined,
                mainImage: p.mainImage || undefined,
                isVariant: false
            });
        }

        // Process variations
        for (const v of variations) {
            const variantName = extractVariantName(v.rawData, v.wooId);

            const baseGoldCogs = calculateGoldCogs(
                Number(v.weight) || 0,
                v.goldPriceType,
                accountPrices
            );
            const goldCogs = baseGoldCogs + sumMiscCosts(v.miscCosts);
            const price = Number(v.price) || 0;
            const profitMargin = calculateMargin(price, goldCogs);

            results.push({
                id: v.id,
                wooId: v.wooId,
                parentWooId: v.product.wooId,
                name: v.product.name,
                variantName,
                sku: v.sku || undefined,
                price,
                goldCogs,
                profitMargin,
                goldPriceType: v.goldPriceType || undefined,
                weight: Number(v.weight) || undefined,
                mainImage: v.product.mainImage || undefined,
                isVariant: true
            });
        }

        // Sort by profit margin (lowest first)
        results.sort((a, b) => a.profitMargin - b.profitMargin);

        // Apply pagination
        const totalCount = results.length;
        const totalPages = Math.ceil(totalCount / limit);
        const startIndex = (page - 1) * limit;
        const paginatedResults = results.slice(startIndex, startIndex + limit);

        return reply.send({
            count: totalCount,
            page,
            limit,
            totalPages,
            products: paginatedResults
        });
    });

    /**
     * GET /api/reports/gold-price/summary
     * 
     * Returns a summary for the dashboard widget.
     * Optimized to fetch only what's needed for the widget.
     */
    fastify.get('/gold-price/summary', async (request, reply) => {
        const accountId = (request.headers['x-account-id'] as string) || (request as any).accountId;
        if (!accountId) {
            return reply.status(400).send({ error: 'Account ID required' });
        }

        // Count products with gold price
        const productCount = await prisma.wooProduct.count({
            where: {
                accountId,
                isGoldPriceApplied: true
            }
        });

        // Count variations with gold price
        const variationCount = await prisma.productVariation.count({
            where: {
                product: { accountId },
                isGoldPriceApplied: true
            }
        });

        const totalCount = productCount + variationCount;

        // Get lowest margin items (top 3)
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: {
                goldPrice18ct: true,
                goldPrice9ct: true,
                goldPrice18ctWhite: true,
                goldPrice9ctWhite: true
            }
        });

        let lowestMarginItems: { name: string; margin: number }[] = [];

        if (account && totalCount > 0) {
            const accountPrices = parseAccountGoldPrices(account);

            // Fetch limited items to calculate margins (optimization: only fetch what we might need)
            const products = await prisma.wooProduct.findMany({
                where: { accountId, isGoldPriceApplied: true },
                select: { name: true, price: true, weight: true, goldPriceType: true, miscCosts: true },
                take: 20
            });

            const variations = await prisma.productVariation.findMany({
                where: { product: { accountId }, isGoldPriceApplied: true },
                select: {
                    price: true,
                    weight: true,
                    goldPriceType: true,
                    miscCosts: true,
                    rawData: true,
                    product: { select: { name: true } }
                },
                take: 20
            });

            const allItems: { name: string; margin: number }[] = [];

            for (const p of products) {
                const goldCogs = calculateGoldCogs(Number(p.weight), p.goldPriceType, accountPrices) + sumMiscCosts(p.miscCosts);
                const margin = calculateMargin(Number(p.price), goldCogs);
                allItems.push({ name: p.name, margin });
            }

            for (const v of variations) {
                const variantName = extractVariantName(v.rawData, 0);
                const name = variantName && variantName !== 'Variant 0'
                    ? `${v.product.name} - ${variantName}`
                    : v.product.name;

                const goldCogs = calculateGoldCogs(Number(v.weight), v.goldPriceType, accountPrices) + sumMiscCosts(v.miscCosts);
                const margin = calculateMargin(Number(v.price), goldCogs);
                allItems.push({ name, margin });
            }

            // Sort and take top 3 lowest
            allItems.sort((a, b) => a.margin - b.margin);
            lowestMarginItems = allItems.slice(0, 3);
        }

        return reply.send({
            totalCount,
            productCount,
            variationCount,
            lowestMarginItems
        });
    });
};

export default goldPriceReportRoutes;
