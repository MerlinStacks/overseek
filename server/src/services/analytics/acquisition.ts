import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export class AcquisitionAnalytics {

    /**
     * Get Acquisition Channels (Referrers)
     */
    static async getAcquisitionChannels(accountId: string, startDate?: string, endDate?: string) {
        try {
            const where: any = { accountId };
            if (startDate || endDate) {
                where.lastActiveAt = { gte: startDate, lte: endDate };
            }

            const groups = await prisma.analyticsSession.groupBy({
                by: ['referrer'],
                where,
                _count: {
                    id: true
                },
                orderBy: {
                    _count: {
                        id: 'desc'
                    }
                },
                take: 50
            });

            return groups.map(g => ({
                channel: g.referrer || 'Direct / None',
                sessions: g._count.id
            }));
        } catch (error) {
            Logger.error('Analytics Channels Error', { error });
            return [];
        }
    }

    /**
     * Get Acquisition Campaigns (UTM)
     */
    static async getAcquisitionCampaigns(accountId: string, startDate?: string, endDate?: string) {
        try {
            const where: any = { accountId };
            // Filter only sessions with UTM params
            where.OR = [
                { utmSource: { not: null } },
                { utmCampaign: { not: null } }
            ];

            if (startDate || endDate) {
                where.lastActiveAt = { gte: startDate, lte: endDate };
            }

            const groups = await prisma.analyticsSession.groupBy({
                by: ['utmSource', 'utmMedium', 'utmCampaign'],
                where,
                _count: {
                    id: true
                },
                orderBy: {
                    _count: {
                        id: 'desc'
                    }
                },
                take: 50
            });

            return groups.map(g => ({
                source: g.utmSource || '(direct)',
                medium: g.utmMedium || '(none)',
                campaign: g.utmCampaign || '(not set)',
                sessions: g._count.id
            }));
        } catch (error) {
            Logger.error('Analytics Campaigns Error', { error });
            return [];
        }
    }
}
