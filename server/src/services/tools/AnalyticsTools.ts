import { AnalyticsService } from '../AnalyticsService';
import { prisma, Prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export class AnalyticsTools {

    static async getVisitorTraffic(accountId: string) {
        try {
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
            const now = new Date();
            let startDate = new Date();

            // Default to 'this_month' if undefined, simple mapping
            if (period === 'last_7_days') startDate.setDate(now.getDate() - 7);
            else if (period === 'last_30_days') startDate.setDate(now.getDate() - 30);
            else startDate.setDate(1); // this_month or default

            const report = await AnalyticsService.getProfitabilityReport(accountId, startDate, now);
            return {
                summary: report.summary,
                top_items_by_margin: report.breakdown.slice(0, 5).map((i: any) => ({
                    name: i.name,
                    margin: `${i.margin.toFixed(1)}%`,
                    profit: i.profit.toFixed(2)
                }))
            };
        } catch (error) {
            Logger.error('Tool Error (getProfitability)', { error });
            return "Failed to calculate profitability.";
        }
    }

    static async forecastSales(accountId: string) {
        try {
            // Simple linear projection based on last 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const dailySales = await prisma.wooOrder.groupBy({
                by: ['dateCreated'],
                where: {
                    accountId,
                    status: 'completed',
                    dateCreated: { gte: thirtyDaysAgo }
                },
                _sum: { total: true },
            });

            // Aggregate by day string to smooth out timestamps
            const salesByDay: Record<string, number> = {};
            dailySales.forEach(s => {
                if (!s.dateCreated) return;
                const day = s.dateCreated.toISOString().split('T')[0];
                salesByDay[day] = (salesByDay[day] || 0) + Number(s._sum.total || 0);
            });

            const values = Object.values(salesByDay);
            if (values.length < 5) return "Not enough data to forecast sales (need at least 5 days of history).";

            // Calculate average daily sales
            const total = values.reduce((a, b) => a + b, 0);
            const avgDaily = total / values.length;

            // Simple trend (growth rate) check - comparing last 5 days vs first 5 days
            const recentAvg = values.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const pastAvg = values.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
            const growthFactor = pastAvg > 0 ? recentAvg / pastAvg : 1;

            const nextWeekTotal = avgDaily * 7 * growthFactor;

            return {
                forecast_next_7_days: nextWeekTotal.toFixed(2),
                trend: growthFactor > 1.05 ? "Growing" : growthFactor < 0.95 ? "Declining" : "Stable",
                confidence: "Moderate (Simple Linear Projection)"
            };

        } catch (error) {
            Logger.error('Tool Error (forecastSales)', { error });
            return "Failed to generate forecast.";
        }
    }

    static async analyzeCustomerSegments(accountId: string, segment: 'at_risk' | 'whales' | 'new') {
        try {
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

            if (segment === 'at_risk') {
                // High spenders who haven't bought in 90 days
                // Note: lastOrderDate not in schema, returning based on high spend only
                const customers = await prisma.wooCustomer.findMany({
                    where: {
                        accountId,
                        totalSpent: { gt: 500 } // Arbitrary 'High Value' threshold
                    },
                    take: 10,
                    orderBy: { totalSpent: 'desc' },
                    select: { firstName: true, email: true, totalSpent: true }
                });
                return customers.length ? customers : "No 'At Risk' high-value customers found.";
            }

            if (segment === 'whales') {
                // Top spenders all time
                const customers = await prisma.wooCustomer.findMany({
                    where: { accountId },
                    take: 10,
                    orderBy: { totalSpent: 'desc' },
                    select: { firstName: true, email: true, totalSpent: true, ordersCount: true }
                });
                return customers;
            }

            return "Segment not supported.";

        } catch (error) {
            Logger.error('Tool Error (analyzeCustomerSegments)', { error });
            return "Failed to analyze segments.";
        }
    }
}
