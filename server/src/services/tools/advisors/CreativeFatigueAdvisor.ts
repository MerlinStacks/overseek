/**
 * Creative Fatigue Advisor
 * 
 * Detects stale ad creatives in Meta campaigns.
 * Extracted from AdOptimizer for modularity.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';

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

                // Fetch ads with creation date and frequency
                const fields = 'ad_name,created_time,frequency';
                const url = `https://graph.facebook.com/v18.0/${actId}/ads?fields=${fields}&effective_status=['ACTIVE']&access_token=${adAccount.accessToken}&limit=50`;

                const response = await fetch(url);
                const data = await response.json();

                if (data.error || !data.data) continue;

                const now = new Date();
                const staleAds: { name: string; age: number }[] = [];
                let highFrequencyCount = 0;

                for (const ad of data.data) {
                    const createdDate = new Date(ad.created_time);
                    const ageInDays = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
                    const frequency = parseFloat(ad.frequency || '0');

                    if (ageInDays > 45) {
                        staleAds.push({ name: ad.ad_name, age: ageInDays });
                    }
                    if (frequency > 5) {
                        highFrequencyCount++;
                    }
                }

                if (staleAds.length > 0) {
                    const oldestAds = staleAds.sort((a, b) => b.age - a.age).slice(0, 2);
                    const names = oldestAds.map(a => `"${a.name}" (${a.age} days)`).join(', ');
                    suggestions.push(
                        `🎨 **Creative Fatigue - Meta**: ${staleAds.length} ad(s) have been running 45+ days: ${names}. ` +
                        `Consider refreshing creatives to maintain performance.`
                    );
                }

                if (highFrequencyCount > 0) {
                    suggestions.push(
                        `👥 **Frequency Alert - Meta**: ${highFrequencyCount} ad(s) have frequency >5. ` +
                        `Your audience is seeing ads repeatedly. Consider expanding targeting or pausing high-frequency ads.`
                    );
                }

            } catch (_err) {
                Logger.debug('Failed to fetch Meta ads for fatigue check', { id: adAccount.id });
            }
        }

    } catch (error) {
        Logger.warn('Failed to process creative fatigue', { error });
    }
}
