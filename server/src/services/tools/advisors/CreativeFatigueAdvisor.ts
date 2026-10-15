/**
 * Creative Fatigue Advisor
 * 
 * Detects stale ad creatives in Meta campaigns.
 * Extracted from AdOptimizer for modularity.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { buildMetaUrl, fetchAllMetaRows } from '../../ads/MetaAdsService';
import { assessCreativeFatigue } from '../../ads/MetaCreativeService';
import { formatDateISO } from '../../ads/types';

/**
 * Detect stale ad creatives in Meta campaigns.
 * @param accountId - The account to analyze
 * @param suggestions - Array to push suggestions into
 */
export async function processCreativeFatigue(
    accountId: string,
    suggestions: string[]
): Promise<void> {
    try {
        const metaAccounts = await prisma.adAccount.findMany({
            where: { accountId, platform: 'META' },
            select: { id: true, name: true, accessToken: true, externalId: true }
        });

        if (metaAccounts.length === 0) return;

        for (const adAccount of metaAccounts) {
            if (!adAccount.accessToken || !adAccount.externalId) continue;

            try {
                const actId = adAccount.externalId.startsWith('act_')
                    ? adAccount.externalId
                    : `act_${adAccount.externalId}`;

                const date = (offset: number) => { const value = new Date(); value.setUTCDate(value.getUTCDate() - offset); return formatDateISO(value); };
                const insights = (since: string, until: string) => fetchAllMetaRows(buildMetaUrl(`${actId}/insights`, {
                    fields: 'ad_id,ad_name,spend,impressions,clicks,actions,action_values,frequency', level: 'ad',
                    time_range: JSON.stringify({ since, until }), limit: 100
                }), adAccount.accessToken!);
                const [recent, previous] = await Promise.all([insights(date(7), date(1)), insights(date(14), date(8))]);
                const priorByAd = new Map(previous.map(row => [row.ad_id, row]));
                const flagged = recent.filter(row => assessCreativeFatigue([row], priorByAd.has(row.ad_id) ? [priorByAd.get(row.ad_id)] : [], true).status === 'potential_fatigue');
                if (flagged.length) suggestions.push(
                    `🎨 **Potential Creative Fatigue - Meta (${adAccount.name || 'Ad account'})**: ${flagged.length} ad(s) show repeated exposure and deteriorating performance across two complete weeks: ` +
                    `${flagged.slice(0, 2).map(row => `"${row.ad_name}"`).join(', ')}. ` +
                    'This is a heuristic, not proof. Review targeting, placements, budget and creative before changing live ads.'
                );

            } catch (_err) {
                Logger.debug('Failed to fetch Meta ads for fatigue check', { id: adAccount.id });
            }
        }

    } catch (error) {
        Logger.warn('Failed to process creative fatigue', { error });
    }
}
