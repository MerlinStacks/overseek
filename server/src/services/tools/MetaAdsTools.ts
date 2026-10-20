import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { AdsService } from '../ads';
import { currencyCode, finiteAmount, record, text } from './toolData';

interface Campaign {
    campaignId: string; campaignName: string; status: string; account: string; currency: string;
    spend: number; clicks: number; impressions: number; conversions: number; conversionsValue: number; roas: number;
}

function campaignReport(campaigns: Campaign[], currency: string, days: number) {
    const totals = campaigns.reduce((sum, c) => ({ spend: sum.spend + c.spend, clicks: sum.clicks + c.clicks,
        impressions: sum.impressions + c.impressions, conversions: sum.conversions + c.conversions,
        conversionsValue: sum.conversionsValue + c.conversionsValue }), { spend: 0, clicks: 0, impressions: 0, conversions: 0, conversionsValue: 0 });
    const money = (amount: number) => `${currency} ${amount.toFixed(2)}`;
    const spenders = [...campaigns].sort((a, b) => b.spend - a.spend);
    return {
        summary: {
            total_campaigns: campaigns.length, total_spend: money(totals.spend), currency, days,
            total_clicks: totals.clicks, total_impressions: totals.impressions, total_conversions: totals.conversions.toFixed(0),
            overall_roas: totals.spend > 0 ? `${(totals.conversionsValue / totals.spend).toFixed(2)}x` : 'N/A',
            overall_ctr: totals.impressions > 0 ? `${(totals.clicks / totals.impressions * 100).toFixed(2)}%` : 'N/A', period: `Last ${days} days`,
        },
        top_spenders: spenders.slice(0, 5).map(c => ({ campaign: c.campaignName, spend: money(c.spend), roas: `${c.roas.toFixed(2)}x`, status: c.status, currency })),
        highest_roas: [...campaigns].filter(c => c.spend > 0).sort((a, b) => b.roas - a.roas).slice(0, 5)
            .map(c => ({ campaign: c.campaignName, roas: `${c.roas.toFixed(2)}x`, spend: money(c.spend), conversions: c.conversions.toFixed(0), currency })),
        underperformers: spenders.filter(c => c.spend > totals.spend * 0.05 && c.roas < 1).slice(0, 3)
            .map(c => ({ campaign: c.campaignName, spend: money(c.spend), roas: `${c.roas.toFixed(2)}x`, currency,
                issue: 'Low reported revenue relative to spend; review attribution, margins and conversion lag before changing budgets' })),
        high_performers: [...campaigns].filter(c => c.spend > 0 && c.roas >= 3).sort((a, b) => b.conversionsValue - a.conversionsValue).slice(0, 3)
            .map(c => ({ campaign: c.campaignName, roas: `${c.roas.toFixed(2)}x`, revenue: money(c.conversionsValue), currency,
                suggestion: 'Review profitability and inventory before a controlled budget test' })),
    };
}

export class MetaAdsTools {
    static async analyzeMetaAdsCampaigns(accountId: string, days = 30) {
        if (!text(accountId)) return 'Account ID required.';
        if (!Number.isSafeInteger(days) || days < 1 || days > 365) return 'Days must be an integer between 1 and 365.';
        try {
            const accounts = await prisma.adAccount.findMany({ where: { accountId, platform: 'META' },
                select: { id: true, name: true, externalId: true, currency: true } });
            if (!accounts.length) return 'No Meta Ads accounts connected. Connect your Meta Ads account in Marketing > Ad Accounts.';
            const campaigns: Campaign[] = [];
            const failedAccounts: string[] = [];
            let excluded = 0;
            for (const account of accounts) {
                try {
                    const rows = await AdsService.getMetaCampaignInsights(account.id, days);
                    if (!Array.isArray(rows)) throw new Error('Invalid campaign data');
                    for (const entry of rows) {
                        const row = record(entry);
                        const currency = currencyCode(row.currency) || currencyCode(account.currency);
                        const values = ['spend', 'clicks', 'impressions', 'conversions', 'conversionsValue'].map(key => finiteAmount(row[key]));
                        if (!currency || values.some(value => value === null)) { excluded++; continue; }
                        const [spend, clicks, impressions, conversions, conversionsValue] = values as number[];
                        campaigns.push({ campaignId: text(row.campaignId) || text(row.id) || `${account.id}:${text(row.campaignName)}`,
                            campaignName: text(row.campaignName) || 'Unnamed campaign', status: text(row.status) || 'UNKNOWN',
                            account: account.name || account.externalId, currency, spend, clicks, impressions, conversions, conversionsValue,
                            roas: spend > 0 ? conversionsValue / spend : 0 });
                    }
                } catch (error) {
                    failedAccounts.push(account.id);
                    Logger.warn('Failed to fetch Meta campaigns', { accountId: account.id, error });
                }
            }
            if (!campaigns.length) return failedAccounts.length || excluded
                ? 'Meta campaign data unavailable or invalid; no complete analysis could be produced.'
                : 'No campaign data available. Please check your Meta Ads connection.';
            const currencies = [...new Set(campaigns.map(c => c.currency))];
            const byCurrency = Object.fromEntries(currencies.map(currency => [currency, campaignReport(campaigns.filter(c => c.currency === currency), currency, days)]));
            const single = byCurrency[currencies[0]];
            const report = currencies.length === 1 ? single : {
                summary: { total_campaigns: campaigns.length, total_spend: 'N/A (mixed currencies; see by_currency)',
                    currency: 'MULTIPLE', days, period: `Last ${days} days`,
                    total_clicks: campaigns.reduce((sum, c) => sum + c.clicks, 0),
                    total_impressions: campaigns.reduce((sum, c) => sum + c.impressions, 0),
                    total_conversions: campaigns.reduce((sum, c) => sum + c.conversions, 0).toFixed(0),
                    overall_roas: 'N/A (mixed currencies)', overall_ctr: 'N/A (see by_currency)' },
                top_spenders: [], highest_roas: [], underperformers: [], high_performers: [],
            };
            return {
                platform: 'META',
                ...report,
                summary: { ...report.summary, partial_data: failedAccounts.length > 0 || excluded > 0,
                    failed_accounts: failedAccounts, excluded_campaigns: excluded,
                    by_currency: Object.fromEntries(Object.entries(byCurrency).map(([currency, value]) => [currency, value.summary])) },
                by_currency: byCurrency, partial_data: failedAccounts.length > 0 || excluded > 0,
                failed_accounts: failedAccounts, excluded_campaigns: excluded,
                campaign_insights: campaigns.map(c => ({ campaignId: c.campaignId, campaignName: c.campaignName, platform: 'meta' as const,
                    currency: c.currency, spend: c.spend, revenue: c.conversionsValue, roas: c.roas,
                    ctr: c.impressions > 0 ? c.clicks / c.impressions * 100 : 0, cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
                    cpa: c.conversions > 0 ? c.spend / c.conversions : 0, conversions: c.conversions, impressions: c.impressions, clicks: c.clicks })),
            };
        } catch (error) {
            Logger.error('Tool Error (analyzeMetaAdsCampaigns)', { error });
            return 'Failed to analyze Meta Ads campaigns.';
        }
    }
}
