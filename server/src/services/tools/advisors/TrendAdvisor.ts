/**
 * Trend Advisor
 * 
 * Analyzes week-over-week performance trends across ad platforms.
 * Extracted from AdOptimizer for modularity.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { AdsService } from '../../ads';
import { TrendMetrics, TrendsSummary } from '../../ads/types';

/**
 * Analyze week-over-week performance trends.
 * @param accountId - The account to analyze
 * @param suggestions - Array to push suggestions into
 * @param summary - Object to populate with trend summary
 */
export async function processTrendAnalysis(
    accountId: string,
    suggestions: string[],
    summary: { trends?: TrendsSummary }
): Promise<void> {
    try {
        const adAccounts = await prisma.adAccount.findMany({
            where: { accountId },
            select: { id: true, platform: true, name: true }
        });

        if (adAccounts.length === 0) return;

        const totalThisWeek: TrendMetrics = { spend: 0, conversionsValue: 0, clicks: 0, impressions: 0 };
        const totalLastWeek: TrendMetrics = { spend: 0, conversionsValue: 0, clicks: 0, impressions: 0 };

        for (const adAccount of adAccounts) {
            try {
                let trends: { spend?: number; conversionsValue?: number; clicks?: number; impressions?: number }[] = [];
                if (adAccount.platform === 'GOOGLE') {
                    trends = await AdsService.getGoogleDailyTrends(adAccount.id, 14);
                } else if (adAccount.platform === 'META') {
                    trends = await AdsService.getMetaDailyTrends(adAccount.id, 14);
                }

                if (trends.length >= 14) {
                    // Split into weeks
                    const thisWeek = trends.slice(-7);
                    const lastWeek = trends.slice(0, 7);

                    for (const day of thisWeek) {
                        totalThisWeek.spend += day.spend || 0;
                        totalThisWeek.conversionsValue += day.conversionsValue || 0;
                        totalThisWeek.clicks += day.clicks || 0;
                        totalThisWeek.impressions += day.impressions || 0;
                    }
                    for (const day of lastWeek) {
                        totalLastWeek.spend += day.spend || 0;
                        totalLastWeek.conversionsValue += day.conversionsValue || 0;
                        totalLastWeek.clicks += day.clicks || 0;
                        totalLastWeek.impressions += day.impressions || 0;
                    }
                }
            } catch (_err) {
                Logger.debug('Failed to fetch trends for account', { id: adAccount.id });
            }
        }

        // Calculate week-over-week changes
        if (totalLastWeek.spend > 0 && totalThisWeek.spend > 0) {
            const thisWeekRoas = totalThisWeek.spend > 0 ? totalThisWeek.conversionsValue / totalThisWeek.spend : 0;
            const lastWeekRoas = totalLastWeek.spend > 0 ? totalLastWeek.conversionsValue / totalLastWeek.spend : 0;
            const roasChange = lastWeekRoas > 0 ? ((thisWeekRoas - lastWeekRoas) / lastWeekRoas) * 100 : 0;

            const thisWeekCtr = totalThisWeek.impressions > 0 ? (totalThisWeek.clicks / totalThisWeek.impressions) * 100 : 0;
            const lastWeekCtr = totalLastWeek.impressions > 0 ? (totalLastWeek.clicks / totalLastWeek.impressions) * 100 : 0;
            const ctrChange = lastWeekCtr > 0 ? ((thisWeekCtr - lastWeekCtr) / lastWeekCtr) * 100 : 0;

            summary.trends = {
                this_week_roas: thisWeekRoas.toFixed(2),
                last_week_roas: lastWeekRoas.toFixed(2),
                roas_change: `${roasChange >= 0 ? '+' : ''}${roasChange.toFixed(0)}%`,
                ctr_change: `${ctrChange >= 0 ? '+' : ''}${ctrChange.toFixed(0)}%`
            };

            // Alert on significant drops
            if (roasChange <= -20) {
                suggestions.unshift(
                    `📉 **Performance Drop**: ROAS dropped ${Math.abs(roasChange).toFixed(0)}% this week ` +
                    `(${lastWeekRoas.toFixed(2)}x → ${thisWeekRoas.toFixed(2)}x). Review recent changes or competitive pressure.`
                );
            } else if (roasChange >= 20) {
                suggestions.push(
                    `📈 **Performance Improving**: ROAS improved ${roasChange.toFixed(0)}% this week ` +
                    `(${lastWeekRoas.toFixed(2)}x → ${thisWeekRoas.toFixed(2)}x). Great progress!`
                );
            }

            if (ctrChange <= -15) {
                suggestions.push(
                    `📉 **CTR Declining**: Click-through rate dropped ${Math.abs(ctrChange).toFixed(0)}% this week. ` +
                    `Consider refreshing ad creatives or adjusting targeting.`
                );
            }
        }

    } catch (error) {
        Logger.warn('Failed to process trend analysis', { error });
    }
}
