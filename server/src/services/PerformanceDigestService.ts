/**
 * Performance Digest Service
 * 
 * Generates AI-powered weekly/monthly performance summaries
 * and sends them via email. Part of AI Co-Pilot v2.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { AdsService } from './ads';
import { EmailService } from './EmailService';

// =============================================================================
// TYPES
// =============================================================================

export interface DigestMetrics {
    periodStart: Date;
    periodEnd: Date;

    // Ad Performance
    ads: {
        totalSpend: number;
        totalRevenue: number;
        roas: number;
        impressions: number;
        clicks: number;
        conversions: number;
        ctr: number;
        cpc: number;

        // Comparisons to previous period
        spendChange: number;
        revenueChange: number;
        roasChange: number;
    };

    // Store Performance
    store: {
        orders: number;
        revenue: number;
        averageOrderValue: number;
        newCustomers: number;

        // Comparisons
        ordersChange: number;
        revenueChange: number;
    };

    // Top Performers
    topProducts: Array<{
        name: string;
        revenue: number;
        orders: number;
    }>;

    topCampaigns: Array<{
        name: string;
        platform: string;
        spend: number;
        revenue: number;
        roas: number;
    }>;

    // AI Actions
    aiActions: {
        total: number;
        executed: number;
        pendingReview: number;
        estimatedSavings: number;
    };
}

export interface DigestNarrative {
    summary: string;
    highlights: string[];
    recommendations: string[];
}

export interface GeneratedDigest {
    metrics: DigestMetrics;
    narrative: DigestNarrative;
    htmlContent: string;
}

// =============================================================================
// SERVICE
// =============================================================================

export class PerformanceDigestService {

    /**
     * Generate a complete performance digest for an account
     */
    static async generateDigest(
        accountId: string,
        periodDays: number = 7
    ): Promise<GeneratedDigest> {
        const periodEnd = new Date();
        const periodStart = new Date();
        periodStart.setDate(periodStart.getDate() - periodDays);

        // Previous period for comparisons
        const prevPeriodEnd = new Date(periodStart);
        const prevPeriodStart = new Date(prevPeriodEnd);
        prevPeriodStart.setDate(prevPeriodStart.getDate() - periodDays);

        // Gather metrics
        const metrics = await this.gatherMetrics(
            accountId,
            periodStart,
            periodEnd,
            prevPeriodStart,
            prevPeriodEnd
        );

        // Generate AI narrative
        const narrative = await this.generateNarrative(accountId, metrics);

        // Render HTML email
        const htmlContent = this.renderDigestEmail(accountId, metrics, narrative);

        // Store digest for history
        await this.storeDigest(accountId, metrics, narrative);

        return { metrics, narrative, htmlContent };
    }

    /**
     * Gather all metrics for the digest
     */
    private static async gatherMetrics(
        accountId: string,
        periodStart: Date,
        periodEnd: Date,
        prevPeriodStart: Date,
        prevPeriodEnd: Date
    ): Promise<DigestMetrics> {
        // Get ad accounts
        const adAccounts = await AdsService.getAdAccounts(accountId);

        // Aggregate ad performance
        let totalSpend = 0;
        let totalAdRevenue = 0;
        let totalImpressions = 0;
        let totalClicks = 0;
        let totalConversions = 0;
        let prevSpend = 0;
        let prevRevenue = 0;

        const topCampaigns: DigestMetrics['topCampaigns'] = [];

        for (const adAccount of adAccounts) {
            try {
                if (adAccount.platform === 'GOOGLE') {
                    const insights = await AdsService.getGoogleInsights(adAccount.id) as any;
                    if (insights) {
                        totalSpend += insights.spend || 0;
                        totalAdRevenue += insights.conversionsValue || 0;
                        totalImpressions += insights.impressions || 0;
                        totalClicks += insights.clicks || 0;
                        totalConversions += insights.conversions || 0;
                    }

                    // Get campaign breakdown
                    const campaigns = await AdsService.getGoogleCampaignInsights(adAccount.id, 7);
                    for (const campaign of campaigns.slice(0, 3)) {
                        topCampaigns.push({
                            name: campaign.campaignName,
                            platform: 'Google',
                            spend: campaign.spend || 0,
                            revenue: campaign.conversionsValue || 0,
                            roas: campaign.roas || 0
                        });
                    }
                } else if (adAccount.platform === 'META') {
                    const insights = await AdsService.getMetaInsights(adAccount.id) as any;
                    if (insights) {
                        totalSpend += insights.spend || 0;
                        totalAdRevenue += insights.purchase_roas?.map((r: any) => r.value).reduce((a: number, b: number) => a + b, 0) || 0;
                        totalImpressions += insights.impressions || 0;
                        totalClicks += insights.clicks || 0;
                    }

                    const campaigns = await AdsService.getMetaCampaignInsights(adAccount.id, 7);
                    for (const campaign of campaigns.slice(0, 3)) {
                        topCampaigns.push({
                            name: campaign.campaignName,
                            platform: 'Meta',
                            spend: campaign.spend || 0,
                            revenue: 0,
                            roas: campaign.roas || 0
                        });
                    }
                }
            } catch (error) {
                Logger.warn('Failed to get ad insights for digest', {
                    adAccountId: adAccount.id,
                    error
                });
            }
        }

        // Get store performance from WooOrder
        const orders = await prisma.wooOrder.findMany({
            where: {
                accountId,
                dateCreated: { gte: periodStart, lte: periodEnd }
            },
            select: { total: true, rawData: true }
        });

        const prevOrders = await prisma.wooOrder.findMany({
            where: {
                accountId,
                dateCreated: { gte: prevPeriodStart, lte: prevPeriodEnd }
            },
            select: { total: true }
        });

        const storeRevenue = orders.reduce((sum, o) => sum + (parseFloat(o.total?.toString() || '0')), 0);
        const prevStoreRevenue = prevOrders.reduce((sum, o) => sum + (parseFloat(o.total?.toString() || '0')), 0);

        // Count unique customers from order raw data
        const customerEmails = new Set<string>();
        for (const order of orders) {
            const rawData = order.rawData as any;
            if (rawData?.billing?.email) {
                customerEmails.add(rawData.billing.email);
            }
        }

        // Get top products from order line items in raw data
        const productSales = new Map<string, { name: string; revenue: number; orders: number }>();
        for (const order of orders) {
            const rawData = order.rawData as any;
            if (rawData?.line_items && Array.isArray(rawData.line_items)) {
                for (const item of rawData.line_items) {
                    const existing = productSales.get(item.product_id?.toString() || item.name);
                    const itemTotal = parseFloat(item.total || '0');
                    if (existing) {
                        existing.revenue += itemTotal;
                        existing.orders += item.quantity || 1;
                    } else {
                        productSales.set(item.product_id?.toString() || item.name, {
                            name: item.name || 'Unknown Product',
                            revenue: itemTotal,
                            orders: item.quantity || 1
                        });
                    }
                }
            }
        }

        const topProducts = Array.from(productSales.values())
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

        // Get AI actions
        const aiActionsTotal = await prisma.adActionLog.count({
            where: {
                accountId,
                createdAt: { gte: periodStart, lte: periodEnd }
            }
        });

        const executedActions = await prisma.adActionLog.count({
            where: {
                accountId,
                createdAt: { gte: periodStart, lte: periodEnd },
                status: 'executed'
            }
        });

        // Calculate derived metrics
        const roas = totalSpend > 0 ? totalAdRevenue / totalSpend : 0;
        const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
        const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
        const aov = orders.length > 0 ? storeRevenue / orders.length : 0;

        return {
            periodStart,
            periodEnd,

            ads: {
                totalSpend,
                totalRevenue: totalAdRevenue,
                roas,
                impressions: totalImpressions,
                clicks: totalClicks,
                conversions: totalConversions,
                ctr,
                cpc,
                spendChange: prevSpend > 0 ? ((totalSpend - prevSpend) / prevSpend) * 100 : 0,
                revenueChange: prevRevenue > 0 ? ((totalAdRevenue - prevRevenue) / prevRevenue) * 100 : 0,
                roasChange: 0
            },

            store: {
                orders: orders.length,
                revenue: storeRevenue,
                averageOrderValue: aov,
                newCustomers: customerEmails.size,
                ordersChange: prevOrders.length > 0
                    ? ((orders.length - prevOrders.length) / prevOrders.length) * 100
                    : 0,
                revenueChange: prevStoreRevenue > 0
                    ? ((storeRevenue - prevStoreRevenue) / prevStoreRevenue) * 100
                    : 0
            },

            topProducts,
            topCampaigns: topCampaigns.sort((a, b) => b.roas - a.roas).slice(0, 5),

            aiActions: {
                total: aiActionsTotal,
                executed: executedActions,
                pendingReview: aiActionsTotal - executedActions,
                estimatedSavings: 0
            }
        };
    }

    /**
     * Generate AI narrative summary
     */
    private static async generateNarrative(
        accountId: string,
        metrics: DigestMetrics
    ): Promise<DigestNarrative> {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { openRouterApiKey: true, aiModel: true, name: true }
        });

        // Fallback to template-based narrative if no AI
        if (!account?.openRouterApiKey) {
            return this.generateTemplateNarrative(metrics, account?.name);
        }

        try {
            const prompt = this.buildNarrativePrompt(metrics, account.name);

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${account.openRouterApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: account.aiModel || 'mistralai/mistral-7b-instruct',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 1000,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                throw new Error(`OpenRouter API error: ${response.status}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';

            // Parse AI response (expecting JSON)
            try {
                const parsed = JSON.parse(content);
                return {
                    summary: parsed.summary || '',
                    highlights: parsed.highlights || [],
                    recommendations: parsed.recommendations || []
                };
            } catch {
                // If not JSON, use as summary
                return {
                    summary: content.slice(0, 500),
                    highlights: [],
                    recommendations: []
                };
            }
        } catch (error) {
            Logger.warn('AI narrative generation failed', { error });
            return this.generateTemplateNarrative(metrics, account?.name);
        }
    }

    /**
     * Build prompt for AI narrative
     */
    private static buildNarrativePrompt(metrics: DigestMetrics, storeName?: string | null): string {
        return `You are a digital marketing analyst. Generate a weekly performance summary for ${storeName || 'the store'}.

METRICS:
- Ad Spend: $${metrics.ads.totalSpend.toFixed(2)} (${metrics.ads.spendChange > 0 ? '+' : ''}${metrics.ads.spendChange.toFixed(1)}% vs last week)
- Ad Revenue: $${metrics.ads.totalRevenue.toFixed(2)}
- ROAS: ${metrics.ads.roas.toFixed(2)}x
- Store Orders: ${metrics.store.orders} (${metrics.store.ordersChange > 0 ? '+' : ''}${metrics.store.ordersChange.toFixed(1)}%)
- Store Revenue: $${metrics.store.revenue.toFixed(2)}
- Average Order Value: $${metrics.store.averageOrderValue.toFixed(2)}
- New Customers: ${metrics.store.newCustomers}
- AI Actions: ${metrics.aiActions.executed} executed of ${metrics.aiActions.total} recommended

TOP PRODUCTS: ${metrics.topProducts.map(p => p.name).join(', ')}
TOP CAMPAIGNS: ${metrics.topCampaigns.map(c => `${c.name} (${c.platform}, ${c.roas.toFixed(2)}x ROAS)`).join(', ')}

OUTPUT FORMAT (JSON only):
{
    "summary": "2-3 sentence executive summary",
    "highlights": ["3-4 key highlights as bullet points"],
    "recommendations": ["2-3 actionable recommendations"]
}`;
    }

    /**
     * Template-based narrative fallback
     */
    private static generateTemplateNarrative(
        metrics: DigestMetrics,
        storeName?: string | null
    ): DigestNarrative {
        const store = storeName || 'Your store';
        const roasStatus = metrics.ads.roas >= 3 ? 'excellent' : metrics.ads.roas >= 2 ? 'good' : 'needs attention';
        const revenueDirection = metrics.store.revenueChange >= 0 ? 'up' : 'down';

        return {
            summary: `${store} generated $${metrics.store.revenue.toFixed(2)} in revenue from ${metrics.store.orders} orders this week. Ad spend of $${metrics.ads.totalSpend.toFixed(2)} delivered a ${roasStatus} ROAS of ${metrics.ads.roas.toFixed(2)}x.`,
            highlights: [
                `Revenue is ${revenueDirection} ${Math.abs(metrics.store.revenueChange).toFixed(1)}% compared to last week`,
                `${metrics.store.newCustomers} new customers acquired`,
                `Top performer: ${metrics.topProducts[0]?.name || 'N/A'}`,
                `${metrics.aiActions.executed} AI recommendations were executed`
            ],
            recommendations: [
                metrics.ads.roas < 2
                    ? 'Consider pausing low-performing campaigns to improve ROAS'
                    : 'Continue optimizing top-performing campaigns',
                metrics.aiActions.pendingReview > 0
                    ? `Review ${metrics.aiActions.pendingReview} pending AI recommendations`
                    : 'All AI recommendations have been addressed'
            ]
        };
    }

    /**
     * Render HTML email content
     */
    private static renderDigestEmail(
        accountId: string,
        metrics: DigestMetrics,
        narrative: DigestNarrative
    ): string {
        const formatCurrency = (val: number) => `$${val.toFixed(2)}`;
        const formatPercent = (val: number) => `${val >= 0 ? '+' : ''}${val.toFixed(1)}%`;

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 24px; }
        .container { max-width: 600px; margin: 0 auto; }
        .header { text-align: center; padding: 24px 0; }
        .logo { font-size: 24px; font-weight: bold; color: #8b5cf6; }
        .period { color: #888; font-size: 14px; margin-top: 8px; }
        .summary-box { background: linear-gradient(135deg, #2d2d44, #1e1e30); border-radius: 16px; padding: 24px; margin: 24px 0; }
        .summary-text { font-size: 16px; line-height: 1.6; }
        .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0; }
        .metric-card { background: #2d2d44; border-radius: 12px; padding: 16px; text-align: center; }
        .metric-value { font-size: 28px; font-weight: bold; color: #fff; }
        .metric-label { font-size: 12px; color: #888; margin-top: 4px; }
        .metric-change { font-size: 12px; margin-top: 4px; }
        .metric-change.positive { color: #10b981; }
        .metric-change.negative { color: #ef4444; }
        .section-title { font-size: 18px; font-weight: 600; margin: 32px 0 16px; color: #fff; }
        .highlights { list-style: none; padding: 0; }
        .highlights li { padding: 8px 0; border-bottom: 1px solid #333; }
        .highlights li:before { content: "✓ "; color: #10b981; }
        .recommendations { background: #2d2d44; border-radius: 12px; padding: 16px; }
        .recommendations li { padding: 8px 0; color: #c4b5fd; }
        .footer { text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #333; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">📊 Weekly Performance Digest</div>
            <div class="period">
                ${metrics.periodStart.toLocaleDateString()} - ${metrics.periodEnd.toLocaleDateString()}
            </div>
        </div>
        
        <div class="summary-box">
            <div class="summary-text">${narrative.summary}</div>
        </div>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value">${formatCurrency(metrics.store.revenue)}</div>
                <div class="metric-label">Store Revenue</div>
                <div class="metric-change ${metrics.store.revenueChange >= 0 ? 'positive' : 'negative'}">
                    ${formatPercent(metrics.store.revenueChange)} vs last week
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${metrics.store.orders}</div>
                <div class="metric-label">Orders</div>
                <div class="metric-change ${metrics.store.ordersChange >= 0 ? 'positive' : 'negative'}">
                    ${formatPercent(metrics.store.ordersChange)} vs last week
                </div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${metrics.ads.roas.toFixed(2)}x</div>
                <div class="metric-label">Ad ROAS</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${formatCurrency(metrics.ads.totalSpend)}</div>
                <div class="metric-label">Ad Spend</div>
            </div>
        </div>
        
        <div class="section-title">📈 Highlights</div>
        <ul class="highlights">
            ${narrative.highlights.map(h => `<li>${h}</li>`).join('')}
        </ul>
        
        <div class="section-title">💡 Recommendations</div>
        <div class="recommendations">
            <ul>
                ${narrative.recommendations.map(r => `<li>${r}</li>`).join('')}
            </ul>
        </div>
        
        <div class="footer">
            Powered by AI Co-Pilot • ${new Date().getFullYear()}<br>
            <a href="#" style="color: #8b5cf6;">View Full Dashboard</a>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Store digest in database for history
     * Uses auditLog to store digest history as there's no dedicated digest table
     */
    private static async storeDigest(
        accountId: string,
        metrics: DigestMetrics,
        narrative: DigestNarrative
    ): Promise<void> {
        try {
            await prisma.auditLog.create({
                data: {
                    accountId,
                    action: 'DIGEST_GENERATED',
                    resource: 'PERFORMANCE_DIGEST',
                    resourceId: `weekly_${metrics.periodStart.toISOString().split('T')[0]}`,
                    details: {
                        metrics: {
                            storeRevenue: metrics.store.revenue,
                            storeOrders: metrics.store.orders,
                            adSpend: metrics.ads.totalSpend,
                            adRevenue: metrics.ads.totalRevenue,
                            roas: metrics.ads.roas
                        },
                        narrative: {
                            summary: narrative.summary,
                            highlights: narrative.highlights,
                            recommendations: narrative.recommendations
                        }
                    }
                }
            });
        } catch (error) {
            Logger.warn('Failed to store digest', { error });
        }
    }

    /**
     * Send digest email to account owners/admins
     */
    static async sendDigest(accountId: string): Promise<void> {
        // Get account info
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { name: true }
        });

        if (!account) {
            Logger.info('Account not found for digest', { accountId });
            return;
        }

        // Get email account for sending
        const emailAccount = await prisma.emailAccount.findFirst({
            where: {
                accountId,
                smtpEnabled: true
            },
            select: { id: true }
        });

        if (!emailAccount) {
            Logger.warn('No SMTP-enabled email account for digest', { accountId });
            return;
        }

        // Get owner/admin users
        const accountUsers = await prisma.accountUser.findMany({
            where: {
                accountId,
                role: { in: ['OWNER', 'ADMIN'] }
            },
            select: {
                user: {
                    select: { email: true, fullName: true }
                }
            }
        });

        if (accountUsers.length === 0) {
            Logger.info('No recipients for digest', { accountId });
            return;
        }

        const digest = await this.generateDigest(accountId);
        const subject = `📊 Weekly Performance Digest - ${account.name || 'Your Store'}`;
        const emailService = new EmailService();

        for (const accountUser of accountUsers) {
            try {
                await emailService.sendEmail(
                    accountId,
                    emailAccount.id,
                    accountUser.user.email,
                    subject,
                    digest.htmlContent
                );

                Logger.info('Digest sent', { accountId, email: accountUser.user.email });
            } catch (error) {
                Logger.error('Failed to send digest', { accountId, email: accountUser.user.email, error });
            }
        }
    }
}

export default PerformanceDigestService;
