/**
 * Executive Report Service
 * 
 * Generates PDF marketing performance reports for executives.
 * Features branded templates, charts, and AI-powered summaries.
 * Part of AI Co-Pilot v2 - Phase 5: Executive Report Generation.
 */

import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { AI_LIMITS } from '../../config/limits';
import { AdMetric, DailyTrend } from './types';
import { MetaAdsService, GoogleAdsService } from './index';

// Ensure reports directory exists
const REPORTS_DIR = path.join(__dirname, '../../../uploads/reports');
if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/** Report generation options */
export interface ReportOptions {
    startDate: Date;
    endDate: Date;
    includeAiSummary?: boolean;
    generatedBy?: string;
}

/** Result of report generation */
export interface ReportResult {
    reportId: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    downloadUrl: string;
}

/** Core metrics for the report */
interface ReportMetrics {
    period: { start: Date; end: Date };
    ads: {
        totalSpend: number;
        totalRevenue: number;
        roas: number;
        impressions: number;
        clicks: number;
        conversions: number;
        ctr: number;
        topCampaigns: { name: string; spend: number; revenue: number; roas: number }[];
        spendByDay: { date: string; spend: number; revenue: number }[];
    };
    store: {
        revenue: number;
        orders: number;
        aov: number;
        revenueByDay: { date: string; revenue: number }[];
    };
    aiActions: {
        total: number;
        executed: number;
        pendingReview: number;
        estimatedSavings: number;
    };
}

/** AI-generated summary */
interface AISummary {
    overview: string;
    highlights: string[];
    recommendations: string[];
}

/**
 * Service for generating executive PDF reports.
 */
export class ExecutiveReportService {
    /**
     * Generate an executive PDF report.
     */
    static async generateReport(
        accountId: string,
        options: ReportOptions
    ): Promise<ReportResult> {
        Logger.info('[ExecutiveReport] Generating report', {
            accountId,
            startDate: options.startDate,
            endDate: options.endDate
        });

        // Gather all metrics
        const metrics = await this.gatherMetrics(
            accountId,
            options.startDate,
            options.endDate
        );

        // Generate AI summary if enabled
        let aiSummary: AISummary | null = null;
        if (options.includeAiSummary !== false) {
            aiSummary = await this.generateAISummary(accountId, metrics);
        }

        // Generate PDF
        const fileName = `report_${accountId}_${Date.now()}.pdf`;
        const filePath = path.join(REPORTS_DIR, fileName);

        await this.renderPdf(filePath, accountId, metrics, aiSummary);

        // Get file size
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;

        // Store report record
        const report = await prisma.executiveReport.create({
            data: {
                accountId,
                periodStart: options.startDate,
                periodEnd: options.endDate,
                fileName,
                filePath,
                fileSize,
                generatedBy: options.generatedBy,
                metrics: metrics as any
            }
        });

        Logger.info('[ExecutiveReport] Report generated', {
            reportId: report.id,
            fileSize
        });

        return {
            reportId: report.id,
            fileName,
            filePath,
            fileSize,
            downloadUrl: `/api/ads/reports/executive/${report.id}`
        };
    }

    /**
     * Gather all metrics for the report.
     */
    private static async gatherMetrics(
        accountId: string,
        startDate: Date,
        endDate: Date
    ): Promise<ReportMetrics> {
        // Get ad accounts
        const adAccounts = await prisma.adAccount.findMany({
            where: { accountId }
        });

        // Initialize metrics
        let totalSpend = 0;
        let totalRevenue = 0;
        let impressions = 0;
        let clicks = 0;
        let conversions = 0;
        const topCampaigns: ReportMetrics['ads']['topCampaigns'] = [];

        // Initialize daily data map
        const dailySpendMap = new Map<string, { date: string; spend: number; revenue: number }>();

        // Aggregate insights from each ad account
        for (const adAccount of adAccounts) {
            try {
                // Use platform-specific service based on account platform
                const normalizedPlatform = adAccount.platform?.toLowerCase();
                let insights: AdMetric | null = null;
                let dailyTrends: DailyTrend[] = [];

                if (normalizedPlatform === 'meta') {
                    insights = await MetaAdsService.getInsights(adAccount.id);
                    dailyTrends = await MetaAdsService.getDailyTrends(adAccount.id);
                } else if (normalizedPlatform === 'google') {
                    insights = await GoogleAdsService.getInsights(adAccount.id);
                    dailyTrends = await GoogleAdsService.getDailyTrends(adAccount.id);
                }

                if (insights) {
                    totalSpend += insights.spend || 0;
                    totalRevenue += insights.revenue || 0;
                    impressions += insights.impressions || 0;
                    clicks += insights.clicks || 0;
                    conversions += insights.conversions || 0;
                }

                if (dailyTrends) {
                    for (const day of dailyTrends) {
                        const existing = dailySpendMap.get(day.date) || { date: day.date, spend: 0, revenue: 0 };
                        existing.spend += day.spend;
                        existing.revenue += day.conversionsValue || 0; // Assuming conversionsValue is revenue in DailyTrend
                        dailySpendMap.set(day.date, existing);
                    }
                }

            } catch (error) {
                Logger.warn('[ExecutiveReport] Failed to get insights', {
                    adAccountId: adAccount.id
                });
            }
        }

        // Convert map to array and sort
        const spendByDay = Array.from(dailySpendMap.values())
            .sort((a, b) => a.date.localeCompare(b.date));

        // Calculate derived metrics
        const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

        // Get store metrics
        const orders = await prisma.wooOrder.findMany({
            where: {
                accountId,
                dateCreated: { gte: startDate, lte: endDate },
                status: { in: ['completed', 'processing'] }
            },
            select: {
                total: true,
                dateCreated: true
            }
        });

        const storeRevenue = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
        const orderCount = orders.length;
        const aov = orderCount > 0 ? storeRevenue / orderCount : 0;

        // Revenue by day
        const revenueByDay: { date: string; revenue: number }[] = [];
        const dateMap = new Map<string, number>();
        for (const order of orders) {
            const dateKey = order.dateCreated.toISOString().split('T')[0];
            dateMap.set(dateKey, (dateMap.get(dateKey) || 0) + Number(order.total || 0));
        }
        for (const [date, revenue] of dateMap) {
            revenueByDay.push({ date, revenue });
        }
        revenueByDay.sort((a, b) => a.date.localeCompare(b.date));

        // Get AI actions
        const aiActionCount = await prisma.scheduledAdAction.count({
            where: { accountId }
        });
        const executedCount = await prisma.adActionLog.count({
            where: {
                accountId,
                executedAt: { gte: startDate, lte: endDate }
            }
        });
        const pendingCount = await prisma.scheduledAdAction.count({
            where: { accountId, status: 'SUGGESTED' }
        });

        // Estimate savings (simplified: assume 10% of executed budget changes)
        const estimatedSavings = executedCount * 50; // Placeholder

        return {
            period: { start: startDate, end: endDate },
            ads: {
                totalSpend,
                totalRevenue,
                roas,
                impressions,
                clicks,
                conversions,
                ctr,
                topCampaigns,
                spendByDay
            },
            store: {
                revenue: storeRevenue,
                orders: orderCount,
                aov,
                revenueByDay
            },
            aiActions: {
                total: aiActionCount,
                executed: executedCount,
                pendingReview: pendingCount,
                estimatedSavings
            }
        };
    }

    /**
     * Generate AI summary and recommendations.
     */
    private static async generateAISummary(
        accountId: string,
        metrics: ReportMetrics
    ): Promise<AISummary> {
        try {
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { name: true, openRouterApiKey: true, aiModel: true }
            });

            if (!account?.openRouterApiKey) {
                return this.generateTemplateSummary(metrics, account?.name);
            }

            const prompt = this.buildSummaryPrompt(metrics, account.name);

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${account.openRouterApiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://overseek.app'
                },
                body: JSON.stringify({
                    model: account.aiModel || AI_LIMITS.DEFAULT_MODEL,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                throw new Error(`OpenRouter API error: ${response.status}`);
            }

            const data = await response.json() as any;
            const content = data.choices?.[0]?.message?.content || '';

            // Parse JSON response
            const parsed = JSON.parse(content);
            return {
                overview: parsed.overview || '',
                highlights: parsed.highlights || [],
                recommendations: parsed.recommendations || []
            };

        } catch (error: any) {
            Logger.warn('[ExecutiveReport] AI summary failed, using template', {
                error: error.message
            });
            return this.generateTemplateSummary(metrics);
        }
    }

    /**
     * Build prompt for AI summary generation.
     */
    private static buildSummaryPrompt(metrics: ReportMetrics, storeName?: string | null): string {
        return `Generate a concise executive summary for ${storeName || 'this store'}'s marketing performance.

METRICS:
- Ad Spend: $${metrics.ads.totalSpend.toFixed(2)}
- Ad Revenue: $${metrics.ads.totalRevenue.toFixed(2)}
- ROAS: ${metrics.ads.roas.toFixed(2)}x
- Store Revenue: $${metrics.store.revenue.toFixed(2)}
- Orders: ${metrics.store.orders}
- AOV: $${metrics.store.aov.toFixed(2)}
- AI Actions Executed: ${metrics.aiActions.executed}

Return a JSON object with:
- "overview": A 2-3 sentence executive summary
- "highlights": Array of 3 key positive takeaways
- "recommendations": Array of 3 actionable recommendations`;
    }

    /**
     * Template-based summary fallback.
     */
    private static generateTemplateSummary(
        metrics: ReportMetrics,
        storeName?: string | null
    ): AISummary {
        const roasStatus = metrics.ads.roas >= 3 ? 'excellent' :
            metrics.ads.roas >= 2 ? 'good' : 'needs improvement';

        return {
            overview: `${storeName || 'The store'} generated $${metrics.store.revenue.toFixed(0)} in revenue from ${metrics.store.orders} orders. Advertising performance shows a ${roasStatus} ROAS of ${metrics.ads.roas.toFixed(2)}x with $${metrics.ads.totalSpend.toFixed(0)} in ad spend.`,
            highlights: [
                `Generated ${metrics.ads.roas.toFixed(2)}x return on advertising spend`,
                `Average order value of $${metrics.store.aov.toFixed(2)}`,
                `${metrics.aiActions.executed} AI-recommended actions executed`
            ],
            recommendations: [
                metrics.ads.roas >= 3 ? 'Consider increasing budget on top performing campaigns' :
                    'Review underperforming campaigns for optimization',
                'Test new creative variants for higher CTR',
                'Continue leveraging AI recommendations for budget optimization'
            ]
        };
    }

    /**
     * Render the PDF document.
     */
    private static async renderPdf(
        filePath: string,
        accountId: string,
        metrics: ReportMetrics,
        aiSummary: AISummary | null
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'A4', margin: 50 });
            const stream = fs.createWriteStream(filePath);

            stream.on('finish', resolve);
            stream.on('error', reject);

            doc.pipe(stream);

            // Colors
            const primaryColor = '#6366f1';
            const textColor = '#1f2937';
            const mutedColor = '#6b7280';

            // Helper functions
            const formatCurrency = (val: number) => `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const formatNumber = (val: number) => val.toLocaleString('en-US');

            // ========================
            // COVER PAGE
            // ========================
            doc.fontSize(32)
                .fillColor(primaryColor)
                .text('Marketing Performance Report', { align: 'center' });

            doc.moveDown(2);
            doc.fontSize(16)
                .fillColor(textColor)
                .text(`Report Period: ${metrics.period.start.toLocaleDateString()} - ${metrics.period.end.toLocaleDateString()}`, { align: 'center' });

            doc.moveDown();
            doc.fontSize(12)
                .fillColor(mutedColor)
                .text(`Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });

            doc.addPage();

            // ========================
            // EXECUTIVE SUMMARY
            // ========================
            doc.fontSize(20)
                .fillColor(primaryColor)
                .text('Executive Summary', { underline: true });

            doc.moveDown();

            if (aiSummary) {
                doc.fontSize(11)
                    .fillColor(textColor)
                    .text(aiSummary.overview, { lineGap: 4 });

                doc.moveDown();
                doc.fontSize(14)
                    .fillColor(primaryColor)
                    .text('Key Highlights');

                doc.moveDown(0.5);
                aiSummary.highlights.forEach(h => {
                    doc.fontSize(11)
                        .fillColor(textColor)
                        .text(`• ${h}`, { lineGap: 2 });
                });
            }

            doc.moveDown(2);

            // ========================
            // AD PERFORMANCE
            // ========================
            doc.fontSize(20)
                .fillColor(primaryColor)
                .text('Advertising Performance', { underline: true });

            doc.moveDown();

            // Key metrics grid
            const adMetrics = [
                ['Total Spend', formatCurrency(metrics.ads.totalSpend)],
                ['Ad Revenue', formatCurrency(metrics.ads.totalRevenue)],
                ['ROAS', `${metrics.ads.roas.toFixed(2)}x`],
                ['Impressions', formatNumber(metrics.ads.impressions)],
                ['Clicks', formatNumber(metrics.ads.clicks)],
                ['CTR', `${metrics.ads.ctr.toFixed(2)}%`]
            ];

            const startX = 50;
            let y = doc.y;
            const colWidth = 170;

            adMetrics.forEach(([label, value], i) => {
                const col = i % 3;
                const row = Math.floor(i / 3);
                const x = startX + (col * colWidth);
                const yPos = y + (row * 40);

                doc.fontSize(10)
                    .fillColor(mutedColor)
                    .text(label, x, yPos);

                doc.fontSize(16)
                    .fillColor(textColor)
                    .text(value, x, yPos + 14);
            });

            doc.y = y + 100;
            doc.moveDown(2);

            // ========================
            // STORE PERFORMANCE
            // ========================
            doc.fontSize(20)
                .fillColor(primaryColor)
                .text('Store Performance', { underline: true });

            doc.moveDown();

            const storeMetrics = [
                ['Total Revenue', formatCurrency(metrics.store.revenue)],
                ['Orders', formatNumber(metrics.store.orders)],
                ['Average Order Value', formatCurrency(metrics.store.aov)]
            ];

            y = doc.y;
            storeMetrics.forEach(([label, value], i) => {
                const x = startX + (i * colWidth);

                doc.fontSize(10)
                    .fillColor(mutedColor)
                    .text(label, x, y);

                doc.fontSize(16)
                    .fillColor(textColor)
                    .text(value, x, y + 14);
            });

            doc.y = y + 60;
            doc.moveDown(2);

            // ========================
            // AI ACTIONS SUMMARY
            // ========================
            doc.fontSize(20)
                .fillColor(primaryColor)
                .text('AI Co-Pilot Activity', { underline: true });

            doc.moveDown();

            const aiMetrics = [
                ['Total Actions', formatNumber(metrics.aiActions.total)],
                ['Executed', formatNumber(metrics.aiActions.executed)],
                ['Pending Review', formatNumber(metrics.aiActions.pendingReview)],
                ['Est. Savings', formatCurrency(metrics.aiActions.estimatedSavings)]
            ];

            y = doc.y;
            aiMetrics.forEach(([label, value], i) => {
                const col = i % 4;
                const x = startX + (col * 130);

                doc.fontSize(10)
                    .fillColor(mutedColor)
                    .text(label, x, y);

                doc.fontSize(14)
                    .fillColor(textColor)
                    .text(value, x, y + 14);
            });

            // ========================
            // RECOMMENDATIONS
            // ========================
            if (aiSummary && aiSummary.recommendations.length > 0) {
                doc.addPage();

                doc.fontSize(20)
                    .fillColor(primaryColor)
                    .text('Recommendations', { underline: true });

                doc.moveDown();

                aiSummary.recommendations.forEach((rec, i) => {
                    doc.fontSize(12)
                        .fillColor(textColor)
                        .text(`${i + 1}. ${rec}`, { lineGap: 6 });
                    doc.moveDown(0.5);
                });
            }

            // ========================
            // FOOTER
            // ========================
            doc.fontSize(8)
                .fillColor(mutedColor)
                .text('Generated by OverSeek AI Co-Pilot', 50, doc.page.height - 50, { align: 'center' });

            doc.end();
        });
    }

    /**
     * Get a report by ID.
     */
    static async getReport(reportId: string, accountId: string): Promise<any> {
        return prisma.executiveReport.findFirst({
            where: { id: reportId, accountId }
        });
    }

    /**
     * List reports for an account.
     */
    static async listReports(accountId: string, limit: number = 10): Promise<any[]> {
        return prisma.executiveReport.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' },
            take: limit
        });
    }

    /**
     * Delete a report.
     */
    static async deleteReport(reportId: string, accountId: string): Promise<void> {
        const report = await prisma.executiveReport.findFirst({
            where: { id: reportId, accountId }
        });

        if (report) {
            // Delete file
            if (fs.existsSync(report.filePath)) {
                fs.unlinkSync(report.filePath);
            }

            // Delete record
            await prisma.executiveReport.delete({
                where: { id: reportId }
            });
        }
    }
}
