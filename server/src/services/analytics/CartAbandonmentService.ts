/**
 * Cart Abandonment Analytics Service
 * 
 * Computes product-level abandonment metrics from tracking events:
 * - Products frequently added but not purchased
 * - Products quickly removed after adding (< 5 min)
 * - Most common products in abandoned carts
 */

import { prisma } from '../../utils/prisma';

export interface ProductAbandonmentStat {
    productId: number;
    productName: string;
    sku: string;
    addToCartCount: number;
    purchaseCount: number;
    removeCount: number;
    abandonmentRate: number;  // (adds - purchases) / adds * 100
    quickRemoveCount: number; // Removed within 5 minutes of adding
}

export interface CartAbandonmentSummary {
    period: string;
    totalAddToCarts: number;
    totalPurchases: number;
    totalRemoves: number;
    overallAbandonmentRate: number;
    topAbandonedProducts: ProductAbandonmentStat[];
    quickRemoveProducts: ProductAbandonmentStat[];
}

/**
 * Get product-level cart abandonment statistics
 */
export async function getCartAbandonmentStats(
    accountId: string,
    startDate: Date,
    endDate: Date
): Promise<CartAbandonmentSummary> {
    // Fetch all add_to_cart, remove_from_cart, and purchase events in the date range
    const events = await prisma.analyticsEvent.findMany({
        where: {
            session: { accountId },
            type: { in: ['add_to_cart', 'remove_from_cart', 'purchase'] },
            createdAt: { gte: startDate, lte: endDate }
        },
        select: {
            id: true,
            sessionId: true,
            type: true,
            payload: true,
            createdAt: true
        },
        orderBy: { createdAt: 'asc' }
    });

    // Track product stats
    const productStats: Map<number, {
        productId: number;
        productName: string;
        sku: string;
        addToCartCount: number;
        purchaseCount: number;
        removeCount: number;
        quickRemoveCount: number;
        addTimes: Map<string, Date>; // sessionId -> last add time
    }> = new Map();

    // Track session add times for quick-remove detection
    const sessionAddTimes: Map<string, Map<number, Date>> = new Map(); // sessionId -> productId -> addTime

    let totalAddToCarts = 0;
    let totalRemoves = 0;
    let totalPurchases = 0;

    for (const event of events) {
        const payload = event.payload as any;
        if (!payload) continue;

        if (event.type === 'add_to_cart') {
            const productId = payload.productId;
            if (!productId) continue;

            totalAddToCarts++;

            // Initialize product stats if needed
            if (!productStats.has(productId)) {
                productStats.set(productId, {
                    productId,
                    productName: payload.name || `Product ${productId}`,
                    sku: payload.sku || '',
                    addToCartCount: 0,
                    purchaseCount: 0,
                    removeCount: 0,
                    quickRemoveCount: 0,
                    addTimes: new Map()
                });
            }

            const stats = productStats.get(productId)!;
            stats.addToCartCount++;
            stats.addTimes.set(event.sessionId, event.createdAt);

            // Track for quick-remove detection
            if (!sessionAddTimes.has(event.sessionId)) {
                sessionAddTimes.set(event.sessionId, new Map());
            }
            sessionAddTimes.get(event.sessionId)!.set(productId, event.createdAt);
        }

        if (event.type === 'remove_from_cart') {
            const productId = payload.productId;
            if (!productId) continue;

            totalRemoves++;

            // Initialize if somehow we see a remove before an add
            if (!productStats.has(productId)) {
                productStats.set(productId, {
                    productId,
                    productName: payload.name || `Product ${productId}`,
                    sku: payload.sku || '',
                    addToCartCount: 0,
                    purchaseCount: 0,
                    removeCount: 0,
                    quickRemoveCount: 0,
                    addTimes: new Map()
                });
            }

            const stats = productStats.get(productId)!;
            stats.removeCount++;

            // Check for quick-remove (within 5 minutes)
            const sessionAdds = sessionAddTimes.get(event.sessionId);
            if (sessionAdds) {
                const addTime = sessionAdds.get(productId);
                if (addTime) {
                    const diffMs = event.createdAt.getTime() - addTime.getTime();
                    const fiveMinMs = 5 * 60 * 1000;
                    if (diffMs < fiveMinMs) {
                        stats.quickRemoveCount++;
                    }
                    // Clear the add time
                    sessionAdds.delete(productId);
                }
            }
        }

        if (event.type === 'purchase') {
            // Count purchases from line items
            const items = payload.items as any[] | undefined;
            if (items && Array.isArray(items)) {
                for (const item of items) {
                    const productId = item.id || item.productId;
                    if (!productId) continue;

                    totalPurchases++;

                    if (!productStats.has(productId)) {
                        productStats.set(productId, {
                            productId,
                            productName: item.name || `Product ${productId}`,
                            sku: item.sku || '',
                            addToCartCount: 0,
                            purchaseCount: 0,
                            removeCount: 0,
                            quickRemoveCount: 0,
                            addTimes: new Map()
                        });
                    }

                    const stats = productStats.get(productId)!;
                    stats.purchaseCount++;
                }
            }
        }
    }

    // Calculate abandonment rates and prepare output
    const allStats: ProductAbandonmentStat[] = [];
    for (const [, stats] of productStats) {
        const abandonmentRate = stats.addToCartCount > 0
            ? ((stats.addToCartCount - stats.purchaseCount) / stats.addToCartCount * 100)
            : 0;

        allStats.push({
            productId: stats.productId,
            productName: stats.productName,
            sku: stats.sku,
            addToCartCount: stats.addToCartCount,
            purchaseCount: stats.purchaseCount,
            removeCount: stats.removeCount,
            abandonmentRate: Math.round(abandonmentRate * 10) / 10,
            quickRemoveCount: stats.quickRemoveCount
        });
    }

    // Sort by abandonment rate (descending) for top abandoned
    const topAbandonedProducts = [...allStats]
        .filter(s => s.addToCartCount >= 3) // Minimum 3 adds for significance
        .sort((a, b) => b.abandonmentRate - a.abandonmentRate)
        .slice(0, 10);

    // Sort by quick-remove count (descending) for quick removes
    const quickRemoveProducts = [...allStats]
        .filter(s => s.quickRemoveCount > 0)
        .sort((a, b) => b.quickRemoveCount - a.quickRemoveCount)
        .slice(0, 10);

    const overallAbandonmentRate = totalAddToCarts > 0
        ? ((totalAddToCarts - totalPurchases) / totalAddToCarts * 100)
        : 0;

    return {
        period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
        totalAddToCarts,
        totalPurchases,
        totalRemoves,
        overallAbandonmentRate: Math.round(overallAbandonmentRate * 10) / 10,
        topAbandonedProducts,
        quickRemoveProducts
    };
}
