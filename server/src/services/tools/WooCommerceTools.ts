import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { NON_REVENUE_ORDER_STATUSES } from '../../constants/orderStatus';
import { SalesAnalytics } from '../analytics/sales';
import { revenuePeriods, validRevenuePeriod } from './revenuePeriods';
import { currencyCode, finiteAmount, record, text, toolLimit } from './toolData';

/** Store insights for the AI, using the same revenue/tax policy as dashboard KPIs. */
export class WooCommerceTools {
    static async getStoreOverview(accountId: string) {
        if (!text(accountId)) return 'Account ID required.';
        try {
            const account = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true, currency: true } });
            if (!account) return 'Account not found.';
            const { start, end } = revenuePeriods('last_7_days', account.timezone);
            const [totalProducts, totalCustomers, totalOrders, totalReviews, revenue, recentOrders] = await Promise.all([
                prisma.wooProduct.count({ where: { accountId } }),
                prisma.wooCustomer.count({ where: { accountId } }),
                prisma.wooOrder.count({ where: { accountId } }),
                prisma.wooReview.count({ where: { accountId } }),
                SalesAnalytics.getTotalSales(accountId, undefined, undefined, { throwOnError: true }),
                prisma.wooOrder.count({ where: { accountId, dateCreated: { gte: start, lt: end } } }),
            ]);
            return { total_products: totalProducts, total_customers: totalCustomers, total_orders: totalOrders,
                total_reviews: totalReviews, lifetime_revenue: revenue.total.toFixed(2), orders_last_7_days: recentOrders, currency: account.currency };
        } catch (error) {
            Logger.error('Tool Error (getStoreOverview)', { error });
            return 'Failed to get store overview.';
        }
    }

    static async getRevenueBreakdown(accountId: string, period = 'last_7_days') {
        if (!text(accountId)) return 'Account ID required.';
        if (!validRevenuePeriod(period)) return 'Unsupported revenue period.';
        try {
            const account = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true, currency: true } });
            if (!account) return 'Account not found.';
            const range = revenuePeriods(period, account.timezone);
            const fetch = (start: Date, end: Date) => end > start
                ? SalesAnalytics.getTotalSales(accountId, start.toISOString(), new Date(end.getTime() - 1).toISOString(), { throwOnError: true })
                : Promise.resolve({ total: 0, count: 0 });
            const [current, previous] = await Promise.all([fetch(range.start, range.end), fetch(range.prevStart, range.prevEnd)]);
            const comparable = previous.total > 0;
            const change = comparable ? (current.total - previous.total) / previous.total * 100 : 0;
            return {
                period, currency: account.currency,
                current_revenue: current.total.toFixed(2), current_orders: current.count,
                previous_revenue: previous.total.toFixed(2), previous_orders: previous.count,
                comparison_available: comparable || current.total === 0,
                change_percent: !comparable && current.total > 0 ? 'N/A (no previous revenue)' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
                trend: current.total > previous.total ? 'up' : current.total < previous.total ? 'down' : 'flat',
            };
        } catch (error) {
            Logger.error('Tool Error (getRevenueBreakdown)', { error });
            return 'Failed to get revenue breakdown.';
        }
    }

    /** Unit rankings from a disclosed sample, grouped by product and currency. */
    static async getTopProducts(accountId: string, limit = 5) {
        if (!text(accountId)) return 'Account ID required.';
        try {
            const orders = await prisma.wooOrder.findMany({
                where: { accountId, status: { notIn: [...NON_REVENUE_ORDER_STATUSES] } },
                select: { rawData: true, currency: true }, take: 500,
                orderBy: [{ dateCreated: 'desc' }, { id: 'asc' }],
            });
            const products = new Map<string, { name: string; count: number; revenue: number; currency: string }>();
            for (const order of orders) {
                const items = record(order.rawData).line_items;
                if (!Array.isArray(items)) continue;
                const currency = currencyCode(order.currency) || 'UNKNOWN';
                for (const entry of items) {
                    const item = record(entry);
                    const quantity = item.quantity == null ? 1 : finiteAmount(item.quantity);
                    const revenue = finiteAmount(item.total ?? 0);
                    if (quantity == null || quantity <= 0 || revenue == null) continue;
                    const id = finiteAmount(item.product_id);
                    const name = text(item.name) || (id ? `Product #${id}` : '');
                    if (!name) continue;
                    const key = `${currency}:${id || name}`;
                    const product = products.get(key) || { name, count: 0, revenue: 0, currency };
                    product.count += quantity;
                    product.revenue += revenue;
                    products.set(key, product);
                }
            }
            const sorted = [...products.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, toolLimit(limit));
            if (!sorted.length) return 'No sales data available to determine top products.';
            return sorted.map((p, idx) => ({ rank: idx + 1, name: p.name, units_sold: p.count, revenue: p.revenue.toFixed(2), currency: p.currency,
                sampled_orders: orders.length, sample_limit: 500, scope: 'Most recent revenue-eligible orders (up to 500); not all-time totals' }));
        } catch (error) {
            Logger.error('Tool Error (getTopProducts)', { error });
            return 'Failed to get top products.';
        }
    }

    static async getTopCustomers(accountId: string, limit = 5) {
        if (!text(accountId)) return 'Account ID required.';
        try {
            const customers = await prisma.wooCustomer.findMany({ where: { accountId }, orderBy: [{ totalSpent: 'desc' }, { id: 'asc' }], take: toolLimit(limit),
                select: { firstName: true, lastName: true, email: true, totalSpent: true, ordersCount: true } });
            if (!customers.length) return 'No customer data available.';
            return customers.map((c, idx) => ({ rank: idx + 1, name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Guest',
                email: c.email, total_spent: c.totalSpent.toFixed(2), orders: c.ordersCount }));
        } catch (error) {
            Logger.error('Tool Error (getTopCustomers)', { error });
            return 'Failed to get top customers.';
        }
    }

    static async getReviewSummary(accountId: string, limit = 5) {
        if (!text(accountId)) return 'Account ID required.';
        try {
            // At most one row per rating, rather than every review body/rating in memory.
            const groups = await prisma.wooReview.groupBy({ by: ['rating'], where: { accountId }, _count: { _all: true } });
            const total = groups.reduce((sum, group) => sum + group._count._all, 0);
            if (!total) return { total_reviews: 0, average_rating: 'No reviews yet', recent_reviews: [] };
            const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            let rated = 0;
            let weighted = 0;
            for (const group of groups) {
                if (Number.isInteger(group.rating) && group.rating >= 1 && group.rating <= 5) {
                    distribution[group.rating] = group._count._all;
                    rated += group._count._all;
                    weighted += group.rating * group._count._all;
                }
            }
            const recent = await prisma.wooReview.findMany({ where: { accountId }, orderBy: [{ dateCreated: 'desc' }, { id: 'asc' }], take: toolLimit(limit),
                select: { rating: true, reviewer: true, productName: true, content: true, dateCreated: true } });
            return {
                total_reviews: total, average_rating: rated ? `${(weighted / rated).toFixed(1)}/5` : 'No rated reviews yet',
                rating_distribution: distribution, unrated_reviews: total - rated,
                recent_reviews: recent.map(r => ({ rating: `${r.rating}/5`, reviewer: r.reviewer, product: r.productName,
                    excerpt: text(r.content).length > 100 ? text(r.content).slice(0, 100) + '...' : text(r.content), date: r.dateCreated.toISOString().slice(0, 10) })),
            };
        } catch (error) {
            Logger.error('Tool Error (getReviewSummary)', { error });
            return 'Failed to get review summary.';
        }
    }
}
