import { AnalyticsService } from '../AnalyticsService';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';
import { extractCustomerId } from '../analytics/utils/orderDataExtractor';
const requireAccount = (accountId: string) => { if (typeof accountId !== 'string' || !accountId.trim()) throw new Error('Account required'); };

export class AnalyticsTools {

    static async getVisitorTraffic(accountId: string) {
        try {
            requireAccount(accountId);
            const result = await AnalyticsService.getVisitorLog(accountId, 1, 10, true); // liveMode=true
            if (result.data.length === 0) return "No active visitors on the site right now.";

            return result.data.map((s: any) => ({
                location: `${s.city || 'Unknown'}, ${s.country || ''}`,
                device: `${s.browser} on ${s.os}`,
                current_page: s.currentPath,
                customer: s.customer ? `${s.customer.firstName} (${s.customer.email})` : 'Guest'
            }));
        } catch (error) {
            Logger.error('Tool Error (getVisitorTraffic)', { error });
            return "Failed to fetch live visitor data.";
        }
    }

    static async getSearchInsights(accountId: string) {
        try {
            requireAccount(accountId);
            const terms = await AnalyticsService.getSearchTerms(accountId);
            if (terms.length === 0) return "No recent search terms recorded.";
            return terms;
        } catch (error) {
            Logger.error('Tool Error (getSearchInsights)', { error });
            return "Failed to fetch search insights.";
        }
    }

    static async getProfitability(accountId: string, period: string) {
        try {
            requireAccount(accountId);
            const now = new Date();
            let startDate = new Date();
            if (!['last_7_days', 'last_30_days', 'this_month'].includes(period)) throw new Error('Unsupported profitability period');

            // Default to 'this_month' if undefined, simple mapping
            if (period === 'last_7_days') startDate.setDate(now.getDate() - 7);
            else if (period === 'last_30_days') startDate.setDate(now.getDate() - 30);
            else { startDate.setDate(1); startDate.setHours(0, 0, 0, 0); }

            const report = await AnalyticsService.getProfitabilityReport(accountId, startDate, now);
            const currencies = await prisma.wooOrder.groupBy({ by: ['currency'], where: { accountId, dateCreated: { gte: startDate, lte: now } } });
            if (currencies.length > 1) throw new Error('Profitability currency is mixed');
            return {
                currency: currencies[0]?.currency ?? null,
                summary: report.summary,
                top_items_by_margin: report.breakdown.slice(0, 5).map((i: any) => ({
                    name: i.name,
                    margin: typeof i.margin === 'number' && Number.isFinite(i.margin) ? `${i.margin.toFixed(1)}%` : 'Unavailable',
                    profit: typeof i.profit === 'number' && Number.isFinite(i.profit) ? i.profit.toFixed(2) : 'Unavailable'
                }))
            };
        } catch (error) {
            Logger.error('Tool Error (getProfitability)', { error });
            return "Failed to calculate profitability.";
        }
    }

    static async forecastSales(accountId: string) {
        try {
            requireAccount(accountId);
            const end = new Date(); end.setUTCHours(0, 0, 0, 0);
            const thirtyDaysAgo = new Date(end.getTime() - 30 * 86400000);
            const dailySales = await prisma.wooOrder.findMany({ where: { accountId, status: { in: REVENUE_STATUSES }, dateCreated: { gte: thirtyDaysAgo, lt: end } },
                select: { dateCreated: true, total: true, currency: true }, take: 50001, orderBy: [{ dateCreated: 'asc' }, { id: 'asc' }] });
            if (dailySales.length > 50000) throw new Error('Forecast coverage limit exceeded');
            const currencies = new Set(dailySales.map(s => s.currency));
            if (currencies.size !== 1 || !/^[A-Z]{3}$/.test(dailySales[0]?.currency || '')) throw new Error('Forecast currency unavailable or mixed');

            // Aggregate by day string to smooth out timestamps
            const salesByDay: Record<string, number> = {};
            for (let day = 0; day < 30; day++) salesByDay[new Date(thirtyDaysAgo.getTime() + day * 86400000).toISOString().slice(0, 10)] = 0;
            const observedDays = new Set<string>();
            dailySales.forEach(s => {
                if (!s.dateCreated) return;
                const day = s.dateCreated.toISOString().split('T')[0];
                const amount = Number(s.total);
                if (!Number.isFinite(amount) || amount < 0 || !(day in salesByDay)) throw new Error('Invalid forecast sales');
                observedDays.add(day); salesByDay[day] += amount;
            });

            const values = Object.values(salesByDay);
            if (observedDays.size < 5) return 'Forecast unavailable: need at least five distinct sales days within 30 complete UTC days.';

            // Calculate average daily sales
            const total = values.reduce((a, b) => a + b, 0);
            const avgDaily = total / values.length;

            // Simple trend (growth rate) check - comparing last 5 days vs first 5 days
            const recentAvg = values.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const pastAvg = values.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
            const growthFactor = pastAvg > 0 ? recentAvg / pastAvg : 1;

            const nextWeekTotal = avgDaily * 7 * growthFactor;

            return {
                forecast_next_7_days: nextWeekTotal.toFixed(2),
                currency: dailySales[0].currency,
                basis: '30 complete UTC days of local revenue orders, including zero-sale days; recent five vs preceding five days',
                trend: growthFactor > 1.05 ? "Growing" : growthFactor < 0.95 ? "Declining" : "Stable",
                confidence: 'Unvalidated heuristic; no statistical confidence estimate'
            };

        } catch (error) {
            Logger.error('Tool Error (forecastSales)', { error });
            return "Failed to generate forecast.";
        }
    }

    static async analyzeCustomerSegments(accountId: string, segment: 'at_risk' | 'whales' | 'new') {
        try {
            requireAccount(accountId);
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

            if (!['at_risk', 'whales', 'new'].includes(segment)) throw new Error('Unsupported customer segment');
            const orders = await prisma.wooOrder.findMany({ where: { accountId, status: { in: REVENUE_STATUSES }, dateCreated: { lte: new Date() } },
                select: { wooCustomerId: true, rawData: true, total: true, currency: true, dateCreated: true }, take: 50001, orderBy: [{ dateCreated: 'asc' }, { id: 'asc' }] });
            if (orders.length > 50000 || new Set(orders.map(order => order.currency)).size > 1) throw new Error('Customer segment coverage/currency unavailable');
            const byCustomer = new Map<number, { first: Date; last: Date; total: number; orders: number }>();
            for (const order of orders) {
                const id = order.wooCustomerId || extractCustomerId(order);
                if (!id) continue;
                const total = Number(order.total);
                if (!Number.isFinite(total) || total < 0) throw new Error('Invalid segment revenue');
                const row = byCustomer.get(id) || { first: order.dateCreated, last: order.dateCreated, total: 0, orders: 0 };
                row.last = order.dateCreated; row.total += total; row.orders++; byCustomer.set(id, row);
            }
            const newSince = new Date(Date.now() - 30 * 86400000);
            const selected = [...byCustomer].filter(([, row]) => segment === 'at_risk' ? row.total > 500 && row.last < ninetyDaysAgo : segment === 'new' ? row.first >= newSince : true)
                .sort((a, b) => b[1].total - a[1].total).slice(0, 10);
            const customers = await prisma.wooCustomer.findMany({ where: { accountId, wooId: { in: selected.map(([id]) => id) } }, select: { wooId: true, firstName: true, email: true } });
            return { segment, basis: 'complete local revenue-order history for registered customer IDs', currency: orders[0]?.currency ?? null,
                ...(segment === 'at_risk' ? { criteria: 'spend > 500 in reported currency and no revenue order in 90 days' } : {}),
                customers: selected.map(([id, row]) => ({ ...customers.find(customer => customer.wooId === id), wooCustomerId: id, totalSpent: row.total, ordersCount: row.orders,
                    firstPurchaseAt: row.first.toISOString(), lastPurchaseAt: row.last.toISOString() })) };

        } catch (error) {
            Logger.error('Tool Error (analyzeCustomerSegments)', { error });
            return "Failed to analyze segments.";
        }
    }
}
