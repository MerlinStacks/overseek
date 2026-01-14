/**
 * Product Opportunity Analyzer
 * 
 * Identifies products that are selling well but not being advertised,
 * or products that should have dedicated campaigns based on performance.
 * 
 * Part of AI Marketing Co-Pilot Actionable Suggestions Enhancement.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { REVENUE_STATUSES } from '../../../constants/orderStatus';
import {
    ActionableRecommendation,
    ProductAction,
    createProductHeadline
} from '../types/ActionableTypes';

// =============================================================================
// TYPES
// =============================================================================

interface ProductVelocity {
    productId: string;
    productName: string;
    sku: string;
    unitsSold: number;
    revenue: number;
    velocity: number; // units per day
    margin?: number;
    cost?: number;
    avgPrice: number;
}

interface ProductOpportunityResult {
    hasData: boolean;
    unpromotedProducts: ActionableRecommendation[];
    underperformingProducts: ActionableRecommendation[];
    highPotentialProducts: ActionableRecommendation[];
    summary: {
        totalProductsAnalyzed: number;
        productsWithSales: number;
        productsInAds: number;
        opportunityCount: number;
    };
}

// =============================================================================
// MAIN ANALYZER
// =============================================================================

export class ProductOpportunityAnalyzer {

    /**
     * Analyze product opportunities by comparing sales velocity with ad coverage.
     */
    static async analyze(
        accountId: string,
        activeAdProductIds?: string[]
    ): Promise<ProductOpportunityResult> {
        const result: ProductOpportunityResult = {
            hasData: false,
            unpromotedProducts: [],
            underperformingProducts: [],
            highPotentialProducts: [],
            summary: {
                totalProductsAnalyzed: 0,
                productsWithSales: 0,
                productsInAds: activeAdProductIds?.length || 0,
                opportunityCount: 0
            }
        };

        try {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            // Get all products with their COGS data
            const products = await prisma.wooProduct.findMany({
                where: { accountId },
                select: {
                    wooId: true,
                    name: true,
                    sku: true,
                    price: true,
                    cost: true,
                    stockQuantity: true,
                    stockStatus: true
                }
            });

            result.summary.totalProductsAnalyzed = products.length;

            if (products.length === 0) {
                return result;
            }

            // Get sales data from orders in the last 30 days
            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: { in: REVENUE_STATUSES },
                    dateCreated: { gte: thirtyDaysAgo }
                },
                select: {
                    wooId: true,
                    total: true,
                    rawData: true,
                    dateCreated: true
                }
            });

            // Calculate product velocity from order line items
            const productSales = new Map<number, {
                units: number;
                revenue: number;
                prices: number[];
            }>();

            for (const order of orders) {
                const lineItems = (order.rawData as any)?.line_items || [];
                for (const item of lineItems) {
                    const productId = item.product_id || item.productId;
                    if (!productId) continue;

                    const current = productSales.get(productId) || { units: 0, revenue: 0, prices: [] };
                    current.units += item.quantity || 1;
                    current.revenue += parseFloat(item.total) || 0;
                    current.prices.push(parseFloat(item.price) || 0);
                    productSales.set(productId, current);
                }
            }

            // Build velocity data for each product
            const velocityData: ProductVelocity[] = [];

            for (const product of products) {
                const sales = productSales.get(product.wooId);
                if (!sales || sales.units === 0) continue;

                const velocity = sales.units / 30; // units per day
                const avgPrice = sales.prices.length > 0
                    ? sales.prices.reduce((a, b) => a + b, 0) / sales.prices.length
                    : parseFloat(String(product.price)) || 0;

                const cost = product.cost ? parseFloat(String(product.cost)) : undefined;
                const margin = cost && avgPrice > 0 ? ((avgPrice - cost) / avgPrice) * 100 : undefined;

                velocityData.push({
                    productId: String(product.wooId),
                    productName: product.name || `Product ${product.wooId}`,
                    sku: product.sku || '',
                    unitsSold: sales.units,
                    revenue: sales.revenue,
                    velocity,
                    margin,
                    cost,
                    avgPrice
                });
            }

            result.summary.productsWithSales = velocityData.length;
            result.hasData = velocityData.length > 0;

            // Normalize ad product IDs for comparison
            const adProductSet = new Set(
                (activeAdProductIds || []).map(id => String(id).toLowerCase())
            );

            // Find unpromoted high-velocity products
            const unpromotedHighVelocity = velocityData
                .filter(p => {
                    const inAds = adProductSet.has(p.productId.toLowerCase()) ||
                        adProductSet.has(p.sku.toLowerCase());
                    return !inAds && p.velocity >= 0.5; // At least 0.5 units/day
                })
                .sort((a, b) => b.velocity - a.velocity)
                .slice(0, 5);

            for (const product of unpromotedHighVelocity) {
                const suggestedBudget = this.calculateSuggestedBudget(product);

                const action: ProductAction = {
                    actionType: 'create_campaign',
                    productId: product.productId,
                    productName: product.productName,
                    sku: product.sku,
                    reason: 'no_coverage',
                    salesVelocity: product.velocity,
                    suggestedBudget,
                    margin: product.margin
                };

                result.unpromotedProducts.push({
                    id: `prod_opp_${product.productId}`,
                    priority: product.velocity >= 2 ? 1 : 2,
                    category: 'optimization',
                    headline: `🚀 ${createProductHeadline(action)}`,
                    explanation: `This product is selling ${product.velocity.toFixed(1)} units/day organically with no ad coverage. ` +
                        `Adding a Shopping campaign could significantly increase sales volume.` +
                        (product.margin ? ` Margin: ${product.margin.toFixed(0)}%` : ''),
                    dataPoints: [
                        `${product.unitsSold} units sold in 30 days`,
                        `$${product.revenue.toFixed(0)} revenue`,
                        `Avg price: $${product.avgPrice.toFixed(2)}`,
                        `No current ad spend`
                    ],
                    action,
                    confidence: this.calculateConfidence(product),
                    estimatedImpact: {
                        revenueChange: product.revenue * 0.5, // Estimated 50% increase
                        spendChange: suggestedBudget * 30,
                        timeframe: '30d'
                    },
                    platform: 'google',
                    source: 'ProductOpportunityAnalyzer',
                    tags: ['shopping', 'opportunity', 'unpromoted']
                });
            }

            // Find high-margin products that could benefit from more visibility
            const highMarginProducts = velocityData
                .filter(p => p.margin && p.margin >= 40 && p.velocity >= 0.3)
                .sort((a, b) => (b.margin || 0) - (a.margin || 0))
                .slice(0, 3);

            for (const product of highMarginProducts) {
                // Skip if already in unpromoted list
                if (unpromotedHighVelocity.some(u => u.productId === product.productId)) continue;

                const action: ProductAction = {
                    actionType: 'increase_visibility',
                    productId: product.productId,
                    productName: product.productName,
                    sku: product.sku,
                    reason: 'high_margin',
                    salesVelocity: product.velocity,
                    margin: product.margin
                };

                result.highPotentialProducts.push({
                    id: `prod_margin_${product.productId}`,
                    priority: 3,
                    category: 'optimization',
                    headline: `💎 Boost "${product.productName}" - ${product.margin?.toFixed(0)}% margin product`,
                    explanation: `High margin product (${product.margin?.toFixed(0)}%) with steady sales. ` +
                        `Increasing ad spend could be very profitable.`,
                    dataPoints: [
                        `Margin: ${product.margin?.toFixed(0)}%`,
                        `Velocity: ${product.velocity.toFixed(1)} units/day`,
                        `Revenue: $${product.revenue.toFixed(0)}/30d`
                    ],
                    action,
                    confidence: 65,
                    platform: 'google',
                    source: 'ProductOpportunityAnalyzer',
                    tags: ['high-margin', 'scaling']
                });
            }

            result.summary.opportunityCount =
                result.unpromotedProducts.length +
                result.underperformingProducts.length +
                result.highPotentialProducts.length;

        } catch (error) {
            Logger.error('ProductOpportunityAnalyzer failed', { error, accountId });
        }

        return result;
    }

    /**
     * Calculate suggested daily budget based on product margin and velocity.
     */
    private static calculateSuggestedBudget(product: ProductVelocity): number {
        // Base budget on:
        // - Average order value * expected conversions * target ROAS margin
        // - Cap at reasonable amount for testing

        const targetRoas = 3; // Target 3x ROAS
        const expectedDailyConversions = Math.max(0.5, product.velocity * 0.3); // 30% lift from ads
        const conversionValue = product.avgPrice;

        // Budget = Value / ROAS
        let budget = (expectedDailyConversions * conversionValue) / targetRoas;

        // Apply margin modifier if available
        if (product.margin && product.margin > 30) {
            budget *= 1.2; // Can afford more spend with higher margin
        }

        // Round to nearest $5 and cap between $5-$50
        budget = Math.round(budget / 5) * 5;
        return Math.max(5, Math.min(50, budget));
    }

    /**
     * Calculate confidence score for a product opportunity.
     */
    private static calculateConfidence(product: ProductVelocity): number {
        let score = 50; // Base score

        // Higher velocity = more confidence
        if (product.velocity >= 3) score += 20;
        else if (product.velocity >= 1) score += 10;

        // More sales data = more confidence
        if (product.unitsSold >= 30) score += 15;
        else if (product.unitsSold >= 10) score += 8;

        // Known margin = more confidence
        if (product.margin && product.margin > 20) score += 10;

        return Math.min(95, score);
    }
}
