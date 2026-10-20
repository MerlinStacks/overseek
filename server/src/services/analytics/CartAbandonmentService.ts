/**
 * Cart Abandonment Analytics Service
 * 
 * Computes product-level abandonment metrics from tracking events:
 * - Products frequently added but not purchased
 * - Products quickly removed after adding (< 5 min)
 * - Most common products in abandoned carts
 */

import { prisma } from '../../utils/prisma';

const EVENT_BATCH_SIZE = 1000;

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function productId(value: unknown): number | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** Event counts are not a cohort conversion rate: purchases may have adds outside the window. */
function abandonmentRate(adds: number, purchases: number): number {
    return adds > 0 ? Math.round(Math.max(0, Math.min(100, (adds - purchases) / adds * 100)) * 10) / 10 : 0;
}

async function* cartEvents(accountId: string, startDate: Date, endDate: Date) {
    let cursor: string | undefined;
    while (true) {
        const events = await prisma.analyticsEvent.findMany({
            where: {
                session: { accountId },
                type: { in: ['add_to_cart', 'remove_from_cart', 'purchase'] },
                createdAt: { gte: startDate, lte: endDate }
            },
            select: { id: true, sessionId: true, type: true, payload: true, createdAt: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: EVENT_BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
        });
        for (const event of events) yield event;
        if (events.length < EVENT_BATCH_SIZE) return;
        cursor = events[events.length - 1].id;
    }
}

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
    if (!accountId || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate > endDate) {
        throw new Error('A valid account and date range are required');
    }

    // Track product stats
    const productStats: Map<number, {
        productId: number;
        productName: string;
        sku: string;
        addToCartCount: number;
        purchaseCount: number;
        removeCount: number;
        quickRemoveCount: number;
    }> = new Map();

    // Track session add times for quick-remove detection
    const sessionAddTimes: Map<string, Map<number, Date>> = new Map(); // sessionId -> productId -> addTime

    let totalAddToCarts = 0;
    let totalRemoves = 0;
    let totalPurchases = 0;

    for await (const event of cartEvents(accountId, startDate, endDate)) {
        const payload = record(event.payload);

        if (event.type === 'add_to_cart') {
            const id = productId(payload.productId);
            if (!id) continue;

            totalAddToCarts++;

            // Initialize product stats if needed
            if (!productStats.has(id)) {
                productStats.set(id, {
                    productId: id,
                    productName: text(payload.name) || `Product ${id}`,
                    sku: text(payload.sku),
                    addToCartCount: 0,
                    purchaseCount: 0,
                    removeCount: 0,
                    quickRemoveCount: 0
                });
            }

            const stats = productStats.get(id)!;
            stats.addToCartCount++;

            // Track for quick-remove detection
            if (!sessionAddTimes.has(event.sessionId)) {
                sessionAddTimes.set(event.sessionId, new Map());
            }
            sessionAddTimes.get(event.sessionId)!.set(id, event.createdAt);
        }

        if (event.type === 'remove_from_cart') {
            const id = productId(payload.productId);
            if (!id) continue;

            totalRemoves++;

            // Initialize if somehow we see a remove before an add
            if (!productStats.has(id)) {
                productStats.set(id, {
                    productId: id,
                    productName: text(payload.name) || `Product ${id}`,
                    sku: text(payload.sku),
                    addToCartCount: 0,
                    purchaseCount: 0,
                    removeCount: 0,
                    quickRemoveCount: 0
                });
            }

            const stats = productStats.get(id)!;
            stats.removeCount++;

            // Check for quick-remove (within 5 minutes)
            const sessionAdds = sessionAddTimes.get(event.sessionId);
            if (sessionAdds) {
                const addTime = sessionAdds.get(id);
                if (addTime) {
                    const diffMs = event.createdAt.getTime() - addTime.getTime();
                    const fiveMinMs = 5 * 60 * 1000;
                    if (diffMs >= 0 && diffMs < fiveMinMs) {
                        stats.quickRemoveCount++;
                    }
                    // Clear the add time
                    sessionAdds.delete(id);
                    if (sessionAdds.size === 0) sessionAddTimes.delete(event.sessionId);
                }
            }
        }

        if (event.type === 'purchase') {
            // Count purchases from line items
            const items = payload.items;
            if (items && Array.isArray(items)) {
                const purchased = new Set<number>();
                for (const entry of items) {
                    const item = record(entry);
                    // Current Woo payloads use id for a variation and productId for its parent.
                    const id = productId(item.productId) ?? productId(item.id);
                    if (!id || purchased.has(id)) continue;
                    purchased.add(id);

                    totalPurchases++;

                    if (!productStats.has(id)) {
                        productStats.set(id, {
                            productId: id,
                            productName: text(item.name) || `Product ${id}`,
                            sku: text(item.sku),
                            addToCartCount: 0,
                            purchaseCount: 0,
                            removeCount: 0,
                            quickRemoveCount: 0
                        });
                    }

                    const stats = productStats.get(id)!;
                    stats.purchaseCount++;
                    const sessionAdds = sessionAddTimes.get(event.sessionId);
                    sessionAdds?.delete(id);
                    if (sessionAdds?.size === 0) sessionAddTimes.delete(event.sessionId);
                }
            }
        }
    }

    // Calculate abandonment rates and prepare output
    const allStats: ProductAbandonmentStat[] = [];
    for (const [, stats] of productStats) {
        allStats.push({
            productId: stats.productId,
            productName: stats.productName,
            sku: stats.sku,
            addToCartCount: stats.addToCartCount,
            purchaseCount: stats.purchaseCount,
            removeCount: stats.removeCount,
            abandonmentRate: abandonmentRate(stats.addToCartCount, stats.purchaseCount),
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

    return {
        period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
        totalAddToCarts,
        totalPurchases,
        totalRemoves,
        overallAbandonmentRate: abandonmentRate(totalAddToCarts, totalPurchases),
        topAbandonedProducts,
        quickRemoveProducts
    };
}
