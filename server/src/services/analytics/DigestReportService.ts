/**
 * Digest Report Service
 * 
 * Generates comprehensive daily/weekly email digests with key business metrics.
 */

import { SalesAnalytics } from './sales';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import {
    calculatePercentChange,
    ANALYTICS_CONFIG
} from './utils';

export interface DigestData {
    period: 'daily' | 'weekly';
    dateRange: {
        start: Date;
        end: Date;
    };
    metrics: {
        revenue: number;
        revenueChange: number;
        orders: number;
        ordersChange: number;
        aov: number;
        aovChange: number;
        newCustomers: number;
        newCustomersChange: number;
    };
    topProducts: Array<{
        name: string;
        quantity: number;
        revenue: number;
    }>;
    topSources: Array<{
        source: string;
        sessions: number;
        revenue: number;
    }>;
}

export class DigestReportService {

    /**
     * Generate a daily digest for yesterday's performance
     */
    static async generateDailyDigest(accountId: string): Promise<DigestData> {
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const endOfYesterday = new Date(yesterday);
        endOfYesterday.setHours(23, 59, 59, 999);

        // Previous day for comparison (day before yesterday)
        const dayBefore = new Date(yesterday);
        dayBefore.setDate(dayBefore.getDate() - 1);
        const endOfDayBefore = new Date(dayBefore);
        endOfDayBefore.setHours(23, 59, 59, 999);

        return this.generateDigest(accountId, 'daily', yesterday, endOfYesterday, dayBefore, endOfDayBefore);
    }

    /**
     * Generate a weekly digest for last week's performance
     */
    static async generateWeeklyDigest(accountId: string): Promise<DigestData> {
        const now = new Date();

        // Last week: 7 days ending yesterday
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() - 1);
        endDate.setHours(23, 59, 59, 999);

        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);

        // Previous week for comparison
        const prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
        prevEndDate.setHours(23, 59, 59, 999);

        const prevStartDate = new Date(prevEndDate);
        prevStartDate.setDate(prevStartDate.getDate() - 6);
        prevStartDate.setHours(0, 0, 0, 0);

        return this.generateDigest(accountId, 'weekly', startDate, endDate, prevStartDate, prevEndDate);
    }

    /**
     * Core digest generation logic
     */
    private static async generateDigest(
        accountId: string,
        period: 'daily' | 'weekly',
        startDate: Date,
        endDate: Date,
        prevStartDate: Date,
        prevEndDate: Date
    ): Promise<DigestData> {
        try {
            // Execute queries in parallel for better performance
            const [
                currentSales,
                previousSales,
                newCustomers,
                prevNewCustomers,
                topProducts,
                topSources
            ] = await Promise.all([
                SalesAnalytics.getTotalSales(accountId, startDate.toISOString(), endDate.toISOString()),
                SalesAnalytics.getTotalSales(accountId, prevStartDate.toISOString(), prevEndDate.toISOString()),
                this.getNewCustomers(accountId, startDate, endDate),
                this.getNewCustomers(accountId, prevStartDate, prevEndDate),
                SalesAnalytics.getTopProducts(accountId, startDate.toISOString(), endDate.toISOString(), 5),
                this.getTopSources(accountId, startDate, endDate)
            ]);

            // Calculate AOV
            const currentAov = currentSales.count > 0 ? currentSales.total / currentSales.count : 0;
            const previousAov = previousSales.count > 0 ? previousSales.total / previousSales.count : 0;

            return {
                period,
                dateRange: { start: startDate, end: endDate },
                metrics: {
                    revenue: currentSales.total,
                    revenueChange: calculatePercentChange(previousSales.total, currentSales.total),
                    orders: currentSales.count,
                    ordersChange: calculatePercentChange(previousSales.count, currentSales.count),
                    aov: currentAov,
                    aovChange: calculatePercentChange(previousAov, currentAov),
                    newCustomers,
                    newCustomersChange: calculatePercentChange(prevNewCustomers, newCustomers),
                },
                topProducts: topProducts.map(p => ({
                    name: p.name,
                    quantity: p.quantity,
                    revenue: 0 // SalesAnalytics doesn't return revenue per product yet
                })),
                topSources,
            };
        } catch (error) {
            Logger.error('[DigestReportService] Error generating digest', { error, accountId });
            throw error;
        }
    }


    /**
     * Get new customer count for a date range
     */
    private static async getNewCustomers(accountId: string, startDate: Date, endDate: Date): Promise<number> {
        const count = await prisma.wooCustomer.count({
            where: {
                accountId,
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                },
            },
        });
        return count;
    }

    /**
     * Get top traffic sources with revenue attribution
     */
    private static async getTopSources(
        accountId: string,
        startDate: Date,
        endDate: Date
    ): Promise<Array<{ source: string; sessions: number; revenue: number }>> {
        const sessions = await prisma.analyticsSession.groupBy({
            by: ['utmSource'],
            where: {
                accountId,
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            _count: { id: true },
        });

        // Map and sort by session count
        const sources = sessions
            .filter(s => s.utmSource)
            .map(s => ({
                source: s.utmSource || 'Direct',
                sessions: s._count.id,
                revenue: 0, // Would need purchase event correlation to calculate
            }))
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, 5);

        // Add Direct if not already present
        const directSessions = await prisma.analyticsSession.count({
            where: {
                accountId,
                createdAt: { gte: startDate, lte: endDate },
                utmSource: null,
                referrer: null,
            },
        });

        if (directSessions > 0) {
            sources.push({ source: 'Direct', sessions: directSessions, revenue: 0 });
            sources.sort((a, b) => b.sessions - a.sessions);
        }

        return sources.slice(0, 5);
    }

    /**
     * Generate HTML email content for a digest
     */
    static generateHtml(data: DigestData, currency: string = 'USD'): string {
        const periodLabel = data.period === 'daily' ? 'Daily' : 'Weekly';
        const dateLabel = data.period === 'daily'
            ? data.dateRange.start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
            : `${data.dateRange.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${data.dateRange.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

        const formatCurrency = (val: number) => `${currency === 'USD' ? '$' : currency} ${val.toFixed(2)}`;
        const formatChange = (val: number) => {
            const arrow = val > 0 ? '↑' : val < 0 ? '↓' : '→';
            const color = val > 0 ? '#22c55e' : val < 0 ? '#ef4444' : '#6b7280';
            return `<span style="color: ${color}; font-weight: 600;">${arrow} ${Math.abs(val)}%</span>`;
        };

        const metricsRow = (label: string, value: string, change: number) => `
            <td style="padding: 16px; text-align: center; border-bottom: 1px solid #e5e7eb;">
                <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">${label}</div>
                <div style="font-size: 24px; font-weight: 700; color: #111827; margin: 4px 0;">${value}</div>
                <div>${formatChange(change)}</div>
            </td>
        `;

        const productRows = data.topProducts.map((p, i) => `
            <tr>
                <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${i + 1}. ${p.name}</td>
                <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; text-align: right;">${p.quantity} sold</td>
            </tr>
        `).join('');

        const sourceRows = data.topSources.map((s, i) => `
            <tr>
                <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${i + 1}. ${s.source}</td>
                <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; text-align: right;">${s.sessions} sessions</td>
            </tr>
        `).join('');

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <!-- Header -->
        <div style="text-align: center; padding: 20px 0;">
            <h1 style="margin: 0; font-size: 28px; color: #111827;">📊 ${periodLabel} Digest</h1>
            <p style="margin: 8px 0 0; color: #6b7280; font-size: 14px;">${dateLabel}</p>
        </div>

        <!-- Key Metrics -->
        <div style="background: white; border-radius: 12px; overflow: hidden; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    ${metricsRow('Revenue', formatCurrency(data.metrics.revenue), data.metrics.revenueChange)}
                    ${metricsRow('Orders', data.metrics.orders.toString(), data.metrics.ordersChange)}
                </tr>
                <tr>
                    ${metricsRow('AOV', formatCurrency(data.metrics.aov), data.metrics.aovChange)}
                    ${metricsRow('New Customers', data.metrics.newCustomers.toString(), data.metrics.newCustomersChange)}
                </tr>
            </table>
        </div>

        <!-- Two Column Layout -->
        <table style="width: 100%; border-collapse: collapse;">
            <tr>
                <td style="vertical-align: top; padding-right: 10px; width: 50%;">
                    <!-- Top Products -->
                    <div style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div style="padding: 12px 16px; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                            <h3 style="margin: 0; font-size: 14px; color: #374151;">🏆 Top Products</h3>
                        </div>
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                            ${productRows || '<tr><td style="padding: 12px; color: #6b7280;">No sales data</td></tr>'}
                        </table>
                    </div>
                </td>
                <td style="vertical-align: top; padding-left: 10px; width: 50%;">
                    <!-- Top Sources -->
                    <div style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div style="padding: 12px 16px; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                            <h3 style="margin: 0; font-size: 14px; color: #374151;">📍 Traffic Sources</h3>
                        </div>
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                            ${sourceRows || '<tr><td style="padding: 12px; color: #6b7280;">No session data</td></tr>'}
                        </table>
                    </div>
                </td>
            </tr>
        </table>

        <!-- Footer -->
        <div style="text-align: center; padding: 24px 0; color: #9ca3af; font-size: 12px;">
            <p style="margin: 0;">Generated by ${process.env.APP_NAME || 'Commerce Platform'}</p>
            <p style="margin: 4px 0 0;">Manage your digest settings in the Reports section</p>
        </div>
    </div>
</body>
</html>
        `.trim();
    }
}
