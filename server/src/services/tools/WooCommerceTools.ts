import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

/**
 * Extended WooCommerce analytics tools for AI chatbot.
 * Provides store-level insights beyond basic orders/products.
 */
export class WooCommerceTools {

    /**
     * Get a general overview of the store's current state.
     */
    static async getStoreOverview(accountId: string) {
        try {
            const [
                totalProducts,
                totalCustomers,
                totalOrders,
                totalReviews,
                revenueAgg
            ] = await Promise.all([
                prisma.wooProduct.count({ where: { accountId } }),
                prisma.wooCustomer.count({ where: { accountId } }),
                prisma.wooOrder.count({ where: { accountId } }),
                prisma.wooReview.count({ where: { accountId } }),
                prisma.wooOrder.aggregate({
                    where: { accountId, status: 'completed' },
                    _sum: { total: true }
                })
            ]);

            // Get recent activity (last 7 days)
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);

            const recentOrders = await prisma.wooOrder.count({
                where: {
                    accountId,
                    dateCreated: { gte: weekAgo }
                }
            });

            return {
                total_products: totalProducts,
                total_customers: totalCustomers,
                total_orders: totalOrders,
                total_reviews: totalReviews,
                lifetime_revenue: revenueAgg._sum.total?.toFixed(2) || '0.00',
                orders_last_7_days: recentOrders
            };

        } catch (error) {
            Logger.error('Tool Error (getStoreOverview)', { error });
            return "Failed to get store overview.";
        }
    }

    /**
     * Get revenue breakdown for a specific period with comparison.
     */
    static async getRevenueBreakdown(accountId: string, period: string = 'last_7_days') {
        try {
            const now = new Date();
            let startDate = new Date();
            let prevStartDate = new Date();
            let prevEndDate = new Date();

            switch (period) {
                case 'today':
                    startDate.setHours(0, 0, 0, 0);
                    prevStartDate.setDate(prevStartDate.getDate() - 1);
                    prevStartDate.setHours(0, 0, 0, 0);
                    prevEndDate = new Date(startDate);
                    break;
                case 'yesterday':
                    startDate.setDate(startDate.getDate() - 1);
                    startDate.setHours(0, 0, 0, 0);
                    prevStartDate.setDate(prevStartDate.getDate() - 2);
                    prevStartDate.setHours(0, 0, 0, 0);
                    prevEndDate = new Date(startDate);
                    break;
                case 'last_7_days':
                    startDate.setDate(startDate.getDate() - 7);
                    prevStartDate.setDate(prevStartDate.getDate() - 14);
                    prevEndDate.setDate(prevEndDate.getDate() - 7);
                    break;
                case 'last_30_days':
                    startDate.setDate(startDate.getDate() - 30);
                    prevStartDate.setDate(prevStartDate.getDate() - 60);
                    prevEndDate.setDate(prevEndDate.getDate() - 30);
                    break;
                case 'this_month':
                    startDate.setDate(1);
                    startDate.setHours(0, 0, 0, 0);
                    prevStartDate.setMonth(prevStartDate.getMonth() - 1);
                    prevStartDate.setDate(1);
                    prevStartDate.setHours(0, 0, 0, 0);
                    prevEndDate = new Date(startDate);
                    break;
                default:
                    startDate.setDate(startDate.getDate() - 7);
                    prevStartDate.setDate(prevStartDate.getDate() - 14);
                    prevEndDate.setDate(prevEndDate.getDate() - 7);
            }

            // Current period
            const currentAgg = await prisma.wooOrder.aggregate({
                where: {
                    accountId,
                    status: 'completed',
                    dateCreated: { gte: startDate, lt: now }
                },
                _sum: { total: true },
                _count: { id: true }
            });

            // Previous period
            const prevAgg = await prisma.wooOrder.aggregate({
                where: {
                    accountId,
                    status: 'completed',
                    dateCreated: { gte: prevStartDate, lt: prevEndDate }
                },
                _sum: { total: true },
                _count: { id: true }
            });

            const currentRevenue = Number(currentAgg._sum.total || 0);
            const prevRevenue = Number(prevAgg._sum.total || 0);

            let changePercent = 0;
            if (prevRevenue > 0) {
                changePercent = ((currentRevenue - prevRevenue) / prevRevenue) * 100;
            }

            return {
                period,
                current_revenue: currentRevenue.toFixed(2),
                current_orders: currentAgg._count.id,
                previous_revenue: prevRevenue.toFixed(2),
                previous_orders: prevAgg._count.id,
                change_percent: `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}%`,
                trend: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat'
            };

        } catch (error) {
            Logger.error('Tool Error (getRevenueBreakdown)', { error });
            return "Failed to get revenue breakdown.";
        }
    }

    /**
     * Get top selling products by order frequency.
     */
    static async getTopProducts(accountId: string, limit: number = 5) {
        try {
            // Get completed orders with their line items
            const orders = await prisma.wooOrder.findMany({
                where: { accountId, status: 'completed' },
                select: { rawData: true },
                take: 500, // Sample last 500 orders
                orderBy: { dateCreated: 'desc' }
            });

            // Count product occurrences from line_items
            const productCounts: Map<string, { name: string; count: number; revenue: number }> = new Map();

            for (const order of orders) {
                const data = order.rawData as any;
                const lineItems = data?.line_items || [];

                for (const item of lineItems) {
                    const key = item.product_id?.toString() || item.name;
                    const existing = productCounts.get(key) || { name: item.name, count: 0, revenue: 0 };
                    existing.count += item.quantity || 1;
                    existing.revenue += parseFloat(item.total || '0');
                    productCounts.set(key, existing);
                }
            }

            // Sort by count and take top N
            const sorted = Array.from(productCounts.values())
                .sort((a, b) => b.count - a.count)
                .slice(0, limit);

            if (sorted.length === 0) {
                return "No sales data available to determine top products.";
            }

            return sorted.map((p, idx) => ({
                rank: idx + 1,
                name: p.name,
                units_sold: p.count,
                revenue: p.revenue.toFixed(2)
            }));

        } catch (error) {
            Logger.error('Tool Error (getTopProducts)', { error });
            return "Failed to get top products.";
        }
    }

    /**
     * Get top customers by total spending.
     */
    static async getTopCustomers(accountId: string, limit: number = 5) {
        try {
            const customers = await prisma.wooCustomer.findMany({
                where: { accountId },
                orderBy: { totalSpent: 'desc' },
                take: limit,
                select: {
                    firstName: true,
                    lastName: true,
                    email: true,
                    totalSpent: true,
                    ordersCount: true
                }
            });

            if (customers.length === 0) {
                return "No customer data available.";
            }

            return customers.map((c, idx) => ({
                rank: idx + 1,
                name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Guest',
                email: c.email,
                total_spent: c.totalSpent.toFixed(2),
                orders: c.ordersCount
            }));

        } catch (error) {
            Logger.error('Tool Error (getTopCustomers)', { error });
            return "Failed to get top customers.";
        }
    }

    /**
     * Get review summary with recent reviews.
     */
    static async getReviewSummary(accountId: string, limit: number = 5) {
        try {
            // Get all reviews for aggregation
            const reviews = await prisma.wooReview.findMany({
                where: { accountId },
                select: { rating: true }
            });

            if (reviews.length === 0) {
                return {
                    total_reviews: 0,
                    average_rating: 'No reviews yet',
                    recent_reviews: []
                };
            }

            // Calculate average rating
            const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
            const avgRating = (totalRating / reviews.length).toFixed(1);

            // Get rating distribution
            const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            for (const r of reviews) {
                if (r.rating >= 1 && r.rating <= 5) {
                    distribution[r.rating]++;
                }
            }

            // Get recent reviews
            const recentReviews = await prisma.wooReview.findMany({
                where: { accountId },
                orderBy: { dateCreated: 'desc' },
                take: limit,
                select: {
                    rating: true,
                    reviewer: true,
                    productName: true,
                    content: true,
                    dateCreated: true
                }
            });

            return {
                total_reviews: reviews.length,
                average_rating: `${avgRating}/5`,
                rating_distribution: distribution,
                recent_reviews: recentReviews.map(r => ({
                    rating: `${r.rating}/5`,
                    reviewer: r.reviewer,
                    product: r.productName,
                    excerpt: r.content.length > 100 ? r.content.substring(0, 100) + '...' : r.content,
                    date: r.dateCreated.toISOString().split('T')[0]
                }))
            };

        } catch (error) {
            Logger.error('Tool Error (getReviewSummary)', { error });
            return "Failed to get review summary.";
        }
    }
}
