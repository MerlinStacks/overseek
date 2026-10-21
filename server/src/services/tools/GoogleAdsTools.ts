/**
 * Google Ads Campaign Analysis Tools
 * 
 * Extracted from AdsTools for modularity.
 * Provides detailed Google Ads campaign analysis for AI tools.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { AdsService } from '../ads';
function validateRows(rows: unknown): asserts rows is any[] {
    if (!Array.isArray(rows) || rows.some(row => !row || !['spend', 'clicks', 'impressions', 'conversions', 'conversionsValue', 'roas'].every(key => typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0) || typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency))) throw new Error('Complete valid advertising metrics/currency unavailable');
}

export class GoogleAdsTools {

    /**
     * Analyze Google Ads campaigns with detailed performance breakdown.
     * Returns campaign-level metrics and identifies opportunities.
     * For Shopping campaigns, includes product-level performance data.
     */
    static async analyzeGoogleAdsCampaigns(accountId: string, days: number = 30) {
        try {
            if (typeof accountId !== 'string' || !accountId.trim() || !Number.isInteger(days) || days < 1 || days > 365) throw new Error('Invalid account or advertising date range');
            const adAccounts = await prisma.adAccount.findMany({
                where: { accountId, platform: 'GOOGLE' },
                select: { id: true, name: true, externalId: true }
            });

            if (adAccounts.length === 0) {
                return "No Google Ads accounts connected. Connect your Google Ads account in Marketing > Ad Accounts.";
            }

            const allCampaigns: any[] = [];
            const allProducts: any[] = [];
            const allKeywords: any[] = [];
            const coverage: Array<{ accountId: string; section: string; status: string; rowLimit?: number }> = [];

            for (const adAccount of adAccounts) {
                try {
                    const campaigns = await AdsService.getGoogleCampaignInsights(adAccount.id, days, { strict: true });
                    validateRows(campaigns);
                    coverage.push({ accountId: adAccount.id, section: 'campaigns', status: 'available' });
                    campaigns.forEach((c: any) => {
                        allCampaigns.push({
                            account: adAccount.name || adAccount.externalId,
                            ...c
                        });
                    });

                    // Also fetch shopping product data
                    try {
                        const products = await AdsService.getGoogleShoppingProducts(adAccount.id, days, 100, { strict: true });
                        validateRows(products);
                        coverage.push({ accountId: adAccount.id, section: 'shopping', status: products.length >= 100 ? 'possibly-truncated' : 'available', rowLimit: 100 });
                        products.forEach((p: any) => {
                            allProducts.push({
                                account: adAccount.name || adAccount.externalId,
                                ...p
                            });
                        });
                    } catch (err) {
                        coverage.push({ accountId: adAccount.id, section: 'shopping', status: 'unavailable' });
                        Logger.debug(`No shopping data for ${adAccount.id}`, { error: (err as Error).message });
                    }

                    // Also fetch search keyword data
                    try {
                        const keywords = await AdsService.getGoogleSearchKeywords(adAccount.id, days, 500, { strict: true });
                        validateRows(keywords);
                        coverage.push({ accountId: adAccount.id, section: 'keywords', status: keywords.length >= 500 ? 'possibly-truncated' : 'available', rowLimit: 500 });
                        keywords.forEach((k: any) => {
                            allKeywords.push({
                                account: adAccount.name || adAccount.externalId,
                                ...k
                            });
                        });
                    } catch (err) {
                        coverage.push({ accountId: adAccount.id, section: 'keywords', status: 'unavailable' });
                        Logger.debug(`No keyword data for ${adAccount.id}`, { error: (err as Error).message });
                    }
                } catch (err) {
                    coverage.push({ accountId: adAccount.id, section: 'all', status: 'unavailable' });
                    Logger.warn(`Failed to fetch campaigns for ${adAccount.id}`, { error: (err as Error).message });
                }
            }

            if (allCampaigns.length === 0) {
                return "No campaign data available. Please check your Google Ads connection.";
            }

            const totals = this.calculateTotals(allCampaigns);
            if (Object.values(totals).some(value => !Number.isFinite(value))) throw new Error('Advertising aggregate overflow');
            const currencies = new Set([...allCampaigns, ...allProducts, ...allKeywords].map(row => row.currency));
            if (currencies.size !== 1) return 'Advertising analysis unavailable: mixed currencies cannot be aggregated.';
            const currency = allCampaigns[0].currency;
            const bySpend = [...allCampaigns].sort((a, b) => b.spend - a.spend);
            const byRoas = [...allCampaigns].filter(c => c.spend > 0).sort((a, b) => b.roas - a.roas);

            const underperformers = allCampaigns
                .filter(c => c.spend > totals.spend * 0.05 && c.roas < 1)
                .sort((a, b) => b.spend - a.spend)
                .slice(0, 3);

            const highPerformers = allCampaigns
                .filter(c => c.roas >= 3)
                .sort((a, b) => b.conversionsValue - a.conversionsValue)
                .slice(0, 3);

            const shoppingAnalysis = this.analyzeShoppingProducts(allProducts);
            const searchAnalysis = this.analyzeSearchKeywords(allKeywords);

            return {
                coverage,
                partial_data: coverage.some(section => section.status !== 'available'),
                currency,
                methodology: 'Enabled campaigns and capped product/keyword samples. ROAS thresholds are review heuristics, not profit or breakeven evidence.',
                summary: {
                    total_campaigns: allCampaigns.length,
                    total_spend: `${currency} ${totals.spend.toFixed(2)}`,
                    total_clicks: totals.clicks,
                    total_impressions: totals.impressions,
                    total_conversions: totals.conversions,
                    overall_roas: totals.spend > 0 ? `${(totals.conversionsValue / totals.spend).toFixed(2)}x` : 'N/A',
                    overall_ctr: totals.impressions > 0 ? `${((totals.clicks / totals.impressions) * 100).toFixed(2)}%` : 'N/A',
                    period: `Requested ${days}-day lookback; provider uses inclusive dates`,
                    dateStart: allCampaigns[0].dateStart ?? null,
                    dateStop: allCampaigns[0].dateStop ?? null,
                },
                top_spenders: bySpend.slice(0, 5).map(c => ({
                    campaign: c.campaignName,
                    spend: `${c.currency} ${c.spend.toFixed(2)}`,
                    roas: `${c.roas.toFixed(2)}x`,
                    status: c.status
                })),
                highest_roas: byRoas.slice(0, 5).map(c => ({
                    campaign: c.campaignName,
                    roas: `${c.roas.toFixed(2)}x`,
                    spend: `${c.currency} ${c.spend.toFixed(2)}`,
                    conversions: c.conversions
                })),
                underperformers: underperformers.map(c => ({
                    campaign: c.campaignName,
                    spend: `${c.currency} ${c.spend.toFixed(2)}`,
                    roas: `${c.roas.toFixed(2)}x`,
                    issue: 'Low reported ROAS; review attribution, margins and conversion lag before acting'
                })),
                high_performers: highPerformers.map(c => ({
                    campaign: c.campaignName,
                    roas: `${c.roas.toFixed(2)}x`,
                    revenue: `${c.currency} ${c.conversionsValue.toFixed(2)}`,
                    suggestion: 'Review margin, attribution and volume before considering budget changes'
                })),
                shopping_products: shoppingAnalysis,
                search_analysis: searchAnalysis,
                // Raw campaign data for knowledge base recommendations
                campaign_insights: allCampaigns.map(c => ({
                    campaignId: c.campaignId || c.id || `${c.campaignName}-${c.account}`,
                    campaignName: c.campaignName,
                    platform: 'google' as const,
                    spend: c.spend,
                    revenue: c.conversionsValue,
                    roas: c.roas,
                    ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : null,
                    cpc: c.clicks > 0 ? c.spend / c.clicks : null,
                    cpa: c.conversions > 0 ? c.spend / c.conversions : null,
                    conversions: c.conversions,
                    impressions: c.impressions,
                    clicks: c.clicks
                }))
            };

        } catch (error) {
            Logger.error('Tool Error (analyzeGoogleAdsCampaigns)', { error });
            return "Failed to analyze Google Ads campaigns.";
        }
    }

    private static calculateTotals(campaigns: any[]) {
        return campaigns.reduce((acc, c) => ({
            spend: acc.spend + c.spend,
            clicks: acc.clicks + c.clicks,
            impressions: acc.impressions + c.impressions,
            conversions: acc.conversions + c.conversions,
            conversionsValue: acc.conversionsValue + c.conversionsValue
        }), { spend: 0, clicks: 0, impressions: 0, conversions: 0, conversionsValue: 0 });
    }

    private static analyzeShoppingProducts(allProducts: any[]) {
        if (allProducts.length === 0) return null;

        const productTotals = allProducts.reduce((acc, p) => ({
            spend: acc.spend + p.spend,
            conversionsValue: acc.conversionsValue + p.conversionsValue
        }), { spend: 0, conversionsValue: 0 });

        const topProducts = [...allProducts]
            .filter(p => p.spend > 0)
            .sort((a, b) => b.roas - a.roas)
            .slice(0, 5);

        const underperformingProducts = [...allProducts]
            .filter(p => p.spend > productTotals.spend * 0.02 && p.roas < 0.5)
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 5);

        const highClickLowConversion = [...allProducts]
            .filter(p => p.clicks > 20 && p.conversions < 1)
            .sort((a, b) => b.clicks - a.clicks)
            .slice(0, 5);

        const productsByCampaign = new Set(allProducts.map(product => `${product.account}:${product.campaignName}`));

        return {
            total_products_analyzed: allProducts.length,
            top_products: topProducts.map(p => ({
                product: p.productTitle,
                product_id: p.productId,
                campaign: p.campaignName,
                roas: `${p.roas.toFixed(2)}x`,
                spend: `${p.currency} ${p.spend.toFixed(2)}`,
                conversions: p.conversions
            })),
            underperforming_products: underperformingProducts.map(p => ({
                product: p.productTitle,
                product_id: p.productId,
                campaign: p.campaignName,
                roas: `${p.roas.toFixed(2)}x`,
                spend: `${p.currency} ${p.spend.toFixed(2)}`,
                issue: p.conversions === 0 ? 'No conversions - consider excluding' : 'Very low ROAS - review pricing/landing page'
            })),
            high_click_low_conversion: highClickLowConversion.map(p => ({
                product: p.productTitle,
                product_id: p.productId,
                campaign: p.campaignName,
                clicks: p.clicks,
                conversions: p.conversions,
                issue: 'High traffic but no sales - check landing page, price, or stock'
            })),
            campaigns_with_products: productsByCampaign.size,
            coverage: 'capped performance sample; absence does not prove a product is not advertised',
            // Return raw set of active product IDs (SKUs or IDs depending on feed setup)
            active_ad_product_ids: Array.from(new Set(allProducts.map(p => p.productId ? String(p.productId) : '')))
        };
    }

    private static analyzeSearchKeywords(allKeywords: any[]) {
        if (allKeywords.length === 0) return null;

        const topKeywords = [...allKeywords]
            .filter(k => k.spend > 0)
            .sort((a, b) => b.roas - a.roas)
            .slice(0, 5);

        const negativeOpportunities = [...allKeywords]
            .filter(k => k.spend > 20 && k.conversions === 0)
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 5);

        const highSpendLowCtr = [...allKeywords]
            .filter(k => k.impressions > 1000 && k.ctr < 1 && k.spend > 10)
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 5);

        return {
            total_keywords_analyzed: allKeywords.length,
            top_keywords: topKeywords.map(k => ({
                keyword: k.keywordText,
                campaign: k.campaignName,
                match_type: k.matchType,
                roas: `${k.roas.toFixed(2)}x`,
                spend: `${k.currency} ${k.spend.toFixed(2)}`,
                conversions: k.conversions
            })),
            negative_opportunities: negativeOpportunities.map(k => ({
                keyword: k.keywordText,
                campaign: k.campaignName,
                match_type: k.matchType,
                spend: `${k.currency} ${k.spend.toFixed(2)}`,
                clicks: k.clicks,
                issue: 'High spend with zero conversions - consider adding as negative keyword'
            })),
            low_ctr_keywords: highSpendLowCtr.map(k => ({
                keyword: k.keywordText,
                campaign: k.campaignName,
                ctr: typeof k.ctr === 'number' && Number.isFinite(k.ctr) ? `${k.ctr.toFixed(2)}%` : 'Unavailable',
                impressions: k.impressions,
                issue: 'Low CTR - ad copy or keyword relevance may need review'
            }))
        };
    }
}
