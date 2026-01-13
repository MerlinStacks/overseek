/**
 * Google Ads Campaign Analysis Tools
 * 
 * Extracted from AdsTools for modularity.
 * Provides detailed Google Ads campaign analysis for AI tools.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { AdsService } from '../ads';

export class GoogleAdsTools {

    /**
     * Analyze Google Ads campaigns with detailed performance breakdown.
     * Returns campaign-level metrics and identifies opportunities.
     * For Shopping campaigns, includes product-level performance data.
     */
    static async analyzeGoogleAdsCampaigns(accountId: string, days: number = 30) {
        try {
            const adAccounts = await prisma.adAccount.findMany({
                where: { accountId, platform: 'GOOGLE' },
                select: { id: true, name: true, externalId: true }
            });

            if (adAccounts.length === 0) {
                return "No Google Ads accounts connected. Connect your Google Ads account in Marketing > Ad Accounts.";
            }

            const allCampaigns: any[] = [];
            const allProducts: any[] = [];

            for (const adAccount of adAccounts) {
                try {
                    const campaigns = await AdsService.getGoogleCampaignInsights(adAccount.id, days);
                    campaigns.forEach((c: any) => {
                        allCampaigns.push({
                            account: adAccount.name || adAccount.externalId,
                            ...c
                        });
                    });

                    // Also fetch shopping product data
                    try {
                        const products = await AdsService.getGoogleShoppingProducts(adAccount.id, days, 100);
                        products.forEach((p: any) => {
                            allProducts.push({
                                account: adAccount.name || adAccount.externalId,
                                ...p
                            });
                        });
                    } catch (err) {
                        Logger.debug(`No shopping data for ${adAccount.id}`, { error: err });
                    }
                } catch (err) {
                    Logger.warn(`Failed to fetch campaigns for ${adAccount.id}`, { error: err });
                }
            }

            if (allCampaigns.length === 0) {
                return "No campaign data available. Please check your Google Ads connection.";
            }

            const totals = this.calculateTotals(allCampaigns);
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

            const shoppingAnalysis = this.analyzeShoppingProducts(allProducts, totals);

            return {
                summary: {
                    total_campaigns: allCampaigns.length,
                    total_spend: `$${totals.spend.toFixed(2)}`,
                    total_clicks: totals.clicks,
                    total_impressions: totals.impressions,
                    total_conversions: totals.conversions.toFixed(0),
                    overall_roas: totals.spend > 0 ? `${(totals.conversionsValue / totals.spend).toFixed(2)}x` : 'N/A',
                    overall_ctr: totals.impressions > 0 ? `${((totals.clicks / totals.impressions) * 100).toFixed(2)}%` : 'N/A',
                    period: `Last ${days} days`
                },
                top_spenders: bySpend.slice(0, 5).map(c => ({
                    campaign: c.campaignName,
                    spend: `$${c.spend.toFixed(2)}`,
                    roas: `${c.roas.toFixed(2)}x`,
                    status: c.status
                })),
                highest_roas: byRoas.slice(0, 5).map(c => ({
                    campaign: c.campaignName,
                    roas: `${c.roas.toFixed(2)}x`,
                    spend: `$${c.spend.toFixed(2)}`,
                    conversions: c.conversions.toFixed(0)
                })),
                underperformers: underperformers.map(c => ({
                    campaign: c.campaignName,
                    spend: `$${c.spend.toFixed(2)}`,
                    roas: `${c.roas.toFixed(2)}x`,
                    issue: c.roas < 0.5 ? 'Very low ROAS - consider pausing' : 'Below breakeven - needs optimization'
                })),
                high_performers: highPerformers.map(c => ({
                    campaign: c.campaignName,
                    roas: `${c.roas.toFixed(2)}x`,
                    revenue: `$${c.conversionsValue.toFixed(2)}`,
                    suggestion: 'Consider increasing budget'
                })),
                shopping_products: shoppingAnalysis
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

    private static analyzeShoppingProducts(allProducts: any[], totals: any) {
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

        const productsByCampaign = allProducts.reduce((acc: Record<string, any[]>, p) => {
            if (!acc[p.campaignName]) acc[p.campaignName] = [];
            acc[p.campaignName].push(p);
            return acc;
        }, {});

        return {
            total_products_analyzed: allProducts.length,
            top_products: topProducts.map(p => ({
                product: p.productTitle,
                product_id: p.productId,
                campaign: p.campaignName,
                roas: `${p.roas.toFixed(2)}x`,
                spend: `$${p.spend.toFixed(2)}`,
                conversions: p.conversions.toFixed(0)
            })),
            underperforming_products: underperformingProducts.map(p => ({
                product: p.productTitle,
                product_id: p.productId,
                campaign: p.campaignName,
                roas: `${p.roas.toFixed(2)}x`,
                spend: `$${p.spend.toFixed(2)}`,
                issue: p.conversions === 0 ? 'No conversions - consider excluding' : 'Very low ROAS - review pricing/landing page'
            })),
            high_click_low_conversion: highClickLowConversion.map(p => ({
                product: p.productTitle,
                product_id: p.productId,
                campaign: p.campaignName,
                clicks: p.clicks,
                conversions: p.conversions.toFixed(0),
                issue: 'High traffic but no sales - check landing page, price, or stock'
            })),
            campaigns_with_products: Object.keys(productsByCampaign).length,
            // Return raw set of active product IDs (SKUs or IDs depending on feed setup)
            active_ad_product_ids: Array.from(new Set(allProducts.map(p => p.productId ? String(p.productId) : '')))
        };
    }
}
