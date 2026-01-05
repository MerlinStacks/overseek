import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Metric Interface
export interface AdMetric {
    accountId: string;
    spend: number;
    impressions: number;
    clicks: number;
    roas: number;
    currency: string;
    date_start: string;
    date_stop: string;
}

export class AdsService {

    // META ADS (Facebook)
    // Uses Graph API v18.0
    static async getMetaInsights(adAccountId: string): Promise<AdMetric | null> {
        const adAccount = await prisma.adAccount.findUnique({
            where: { id: adAccountId }
        });

        if (!adAccount || adAccount.platform !== 'META' || !adAccount.accessToken || !adAccount.externalId) {
            throw new Error('Invalid Meta Ad Account');
        }

        const actId = adAccount.externalId.startsWith('act_') ? adAccount.externalId : `act_${adAccount.externalId}`;
        const fields = 'spend,impressions,clicks,purchase_roas,action_values';
        // last_30d
        const url = `https://graph.facebook.com/v18.0/${actId}/insights?fields=${fields}&date_preset=last_30d&access_token=${adAccount.accessToken}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                console.error('Meta API Error:', data.error);
                throw new Error(data.error.message);
            }

            const insights = data.data?.[0]; // Aggregate for 30d
            if (!insights) return null;

            // Calculate ROAS manually if purchase_roas is complex structure
            // Meta returns purchase_roas as list of actions.
            // Simplified: Spend

            const spend = parseFloat(insights.spend || '0');

            // Calculate ROAS
            // Meta returns action_values as [{ action_type: 'purchase', value: '123.45' }, ...]
            let purchaseValue = 0;
            if (insights.action_values && Array.isArray(insights.action_values)) {
                const purchaseAction = insights.action_values.find((a: any) => a.action_type === 'purchase' || a.action_type === 'omni_purchase');
                if (purchaseAction && purchaseAction.value) {
                    purchaseValue = parseFloat(purchaseAction.value);
                }
            }

            const roas = spend > 0 ? purchaseValue / spend : 0;

            return {
                accountId: adAccountId,
                spend,
                impressions: parseInt(insights.impressions || '0'),
                clicks: parseInt(insights.clicks || '0'),
                roas,
                currency: adAccount.currency || 'USD',
                date_start: insights.date_start,
                date_stop: insights.date_stop
            };

        } catch (error) {
            console.error('Failed to fetch Meta Insights', error);
            throw error;
        }
    }

    // Generic "Get All Connected Accounts" for a User's Store
    static async getAdAccounts(accountId: string) {
        return prisma.adAccount.findMany({
            where: { accountId }
        });
    }

    static async connectAccount(accountId: string, data: { platform: string, externalId: string, accessToken: string, name?: string }) {
        return prisma.adAccount.create({
            data: {
                accountId,
                platform: data.platform,
                externalId: data.externalId,
                accessToken: data.accessToken,
                name: data.name || `${data.platform} Account`
            }
        });
    }
}
