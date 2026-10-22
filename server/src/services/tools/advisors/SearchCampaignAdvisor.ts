import { prisma } from '../../../utils/prisma';
import { AdsService } from '../../ads';
import { boundedRead, currencyCode, nonnegative, trustedAccount } from '../analysisObservations';

export class SearchCampaignAdvisor {
    static async analyze(accountId: string) {
        trustedAccount(accountId);
        const accounts = await prisma.adAccount.findMany({ where: { accountId, platform: 'GOOGLE' }, select: { id: true }, orderBy: { id: 'asc' }, take: 51 });
        if (accounts.length > 50) throw new Error('Account scan limit exceeded');
        const outcomes = await Promise.allSettled(accounts.map(async account => {
            const rows = await boundedRead(AdsService.getGoogleCampaignInsights(account.id, 30, { strict: true }));
            if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid campaign sample');
            const ids = new Set<string>();
            return rows.map(row => {
                if (!row || typeof row.campaignId !== 'string' || !row.campaignId || row.campaignId.length > 200 || ids.has(row.campaignId) || ![row.spend, row.conversionsValue, row.clicks, row.impressions, row.conversions].every(nonnegative) || !currencyCode(row.currency) || !/^\d{4}-\d{2}-\d{2}$/.test(row.dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(row.dateStop) || row.dateStart > row.dateStop) throw new Error('Invalid campaign observations');
                ids.add(row.campaignId);
                return { adAccountId: account.id, campaignId: row.campaignId, name: typeof row.campaignName === 'string' ? row.campaignName.slice(0, 500) : row.campaignId,
                    channel: row.advertisingChannelType ?? null, spend: row.spend, revenue: row.conversionsValue, roas: row.spend > 0 ? row.conversionsValue / row.spend : null, currency: row.currency, startDate: row.dateStart, endDate: row.dateStop };
            });
        }));
        const rows = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? outcome.value : []);
        const search = rows.filter(row => row.channel === 'SEARCH');
        const compatible = search.length > 0 && new Set(search.map(row => `${row.currency}:${row.startDate}:${row.endDate}`)).size === 1;
        const spend = compatible ? search.reduce((total, row) => total + row.spend, 0) : null;
        const revenue = compatible ? search.reduce((total, row) => total + row.revenue, 0) : null;
        return { hasData: search.length > 0, recommendations: [], suggestions: ['Review verified SEARCH-channel observations. Absent or partial returned campaigns do not prove you are not running Search. Historical spend is not a budget; no campaign, CPC, offer or revenue-lift forecast was invented.'],
            campaigns: search, summary: { campaignsAnalyzed: search.length, totalSearchSpend: spend, avgSearchRoas: spend !== null && spend > 0 && revenue !== null ? revenue / spend : null, currency: compatible ? search[0].currency : null, opportunitiesFound: null },
            coverage: { expectedAccounts: accounts.length, observedAccounts: outcomes.filter(o => o.status === 'fulfilled').length, unknownChannelRows: rows.filter(row => row.channel === null).length, basis: 'provider-returned-campaign-sample', complete: false } };
    }
}
