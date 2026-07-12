import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';

export class AcquisitionAnalytics {

    private static getChannelFromReferrer(referrer?: string | null) {
        if (!referrer) return 'Direct / None';

        let hostname = referrer.toLowerCase().trim();
        try {
            hostname = new URL(hostname.startsWith('http') ? hostname : `https://${hostname}`).hostname;
        } catch {
            hostname = hostname.split('/')[0];
        }

        hostname = hostname.replace(/^www\./, '').replace(/^m\./, '').replace(/^l\./, '').replace(/^lm\./, '');

        if (hostname.includes('facebook.') || hostname === 'fb.com' || hostname === 'fb.me') return 'Facebook';
        if (hostname.includes('instagram.')) return 'Instagram';
        if (hostname.includes('google.')) return 'Google';
        if (hostname.includes('youtube.') || hostname === 'youtu.be') return 'YouTube';
        if (hostname.includes('tiktok.')) return 'TikTok';
        if (hostname.includes('bing.')) return 'Bing';
        if (hostname.includes('yahoo.')) return 'Yahoo';
        if (hostname.includes('duckduckgo.')) return 'DuckDuckGo';
        if (hostname.includes('linkedin.')) return 'LinkedIn';
        if (hostname.includes('twitter.') || hostname === 'x.com' || hostname.includes('t.co')) return 'X / Twitter';
        if (hostname.includes('pinterest.')) return 'Pinterest';
        if (hostname.includes('reddit.')) return 'Reddit';

        return hostname;
    }

    /**
     * Get Acquisition Channels (Referrers)
     */
    static async getAcquisitionChannels(accountId: string, startDate?: string, endDate?: string) {
        try {
            const dateFilter: any = {};
            if (startDate) dateFilter.gte = new Date(startDate);
            if (endDate) dateFilter.lte = new Date(endDate);

            const sessionWhere = {
                accountId,
                ...(Object.keys(dateFilter).length > 0 && { lastActiveAt: dateFilter })
            };

            const [sessions, purchaseEvents] = await Promise.all([
                prisma.analyticsSession.findMany({
                    where: sessionWhere,
                    select: { id: true, referrer: true }
                }),
                prisma.analyticsEvent.findMany({
                    where: {
                        session: { accountId },
                        type: 'purchase',
                        ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
                    },
                    select: {
                        sessionId: true,
                        session: { select: { referrer: true } }
                    }
                })
            ]);

            const channels = new Map<string, {
                channel: string;
                sessions: number;
                conversions: number;
                convertingSessions: Set<string>;
                domains: Set<string>;
            }>();

            const ensureChannel = (channel: string) => {
                if (!channels.has(channel)) {
                    channels.set(channel, {
                        channel,
                        sessions: 0,
                        conversions: 0,
                        convertingSessions: new Set(),
                        domains: new Set()
                    });
                }
                return channels.get(channel)!;
            };

            for (const session of sessions) {
                const channel = this.getChannelFromReferrer(session.referrer);
                const row = ensureChannel(channel);
                row.sessions++;
                if (session.referrer) row.domains.add(session.referrer);
            }

            for (const event of purchaseEvents) {
                const channel = this.getChannelFromReferrer(event.session?.referrer);
                const row = ensureChannel(channel);
                row.conversions++;
                row.convertingSessions.add(event.sessionId);
                if (event.session?.referrer) row.domains.add(event.session.referrer);
            }

            return Array.from(channels.values()).map(row => {
                const exitedSessions = Math.max(row.sessions - row.convertingSessions.size, 0);
                return {
                    channel: row.channel,
                    sessions: row.sessions,
                    conversions: row.conversions,
                    exitRate: row.sessions > 0 ? Math.round((exitedSessions / row.sessions) * 10000) / 100 : 0,
                    domains: Array.from(row.domains).sort()
                };
            }).sort((a, b) => b.sessions - a.sessions).slice(0, 50);
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
            const dateFilter: any = {};
            if (startDate) dateFilter.gte = new Date(startDate);
            if (endDate) dateFilter.lte = new Date(endDate);

            const normalizeCampaign = (source?: string | null, medium?: string | null, campaign?: string | null) => ({
                source: source || '(direct)',
                medium: medium || '(none)',
                campaign: campaign || '(not set)'
            });

            const getKey = (source?: string | null, medium?: string | null, campaign?: string | null) => {
                const normalized = normalizeCampaign(source, medium, campaign);
                return `${normalized.source}\u0000${normalized.medium}\u0000${normalized.campaign}`;
            };

            const [sessionGroups, purchaseEvents] = await Promise.all([
                prisma.analyticsSession.groupBy({
                    by: ['utmSource', 'utmMedium', 'utmCampaign'],
                    where: {
                        accountId,
                        OR: [
                            { utmSource: { not: null } },
                            { utmCampaign: { not: null } }
                        ],
                        ...(Object.keys(dateFilter).length > 0 && { lastActiveAt: dateFilter })
                    },
                    _count: { id: true },
                    orderBy: { _count: { id: 'desc' } },
                    take: 50
                }),
                prisma.analyticsEvent.findMany({
                    where: {
                        session: { accountId },
                        type: 'purchase',
                        ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
                    },
                    select: {
                        orderId: true,
                        session: { select: { utmSource: true, utmMedium: true, utmCampaign: true } }
                    }
                })
            ]);

            const orderIds = Array.from(new Set(purchaseEvents.map(event => event.orderId).filter((id): id is number => typeof id === 'number')));
            const orders = orderIds.length > 0 ? await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    wooId: { in: orderIds },
                    status: { in: REVENUE_STATUSES },
                    ...(Object.keys(dateFilter).length > 0 && { dateCreated: dateFilter })
                },
                select: { wooId: true, total: true }
            }) : [];
            const revenueByOrderId = new Map(orders.map(order => [order.wooId, Number(order.total)]));

            const campaigns = new Map<string, {
                source: string;
                medium: string;
                campaign: string;
                sessions: number;
                conversions: number;
                revenue: number;
                countedOrders: Set<number>;
            }>();

            const ensureCampaign = (source?: string | null, medium?: string | null, campaign?: string | null) => {
                const normalized = normalizeCampaign(source, medium, campaign);
                const key = getKey(source, medium, campaign);
                if (!campaigns.has(key)) {
                    campaigns.set(key, {
                        ...normalized,
                        sessions: 0,
                        conversions: 0,
                        revenue: 0,
                        countedOrders: new Set()
                    });
                }
                return campaigns.get(key)!;
            };

            for (const group of sessionGroups) {
                const row = ensureCampaign(group.utmSource, group.utmMedium, group.utmCampaign);
                row.sessions = group._count.id;
            }

            for (const event of purchaseEvents) {
                const row = ensureCampaign(event.session?.utmSource, event.session?.utmMedium, event.session?.utmCampaign);
                row.conversions++;

                if (event.orderId && revenueByOrderId.has(event.orderId) && !row.countedOrders.has(event.orderId)) {
                    row.revenue += revenueByOrderId.get(event.orderId) || 0;
                    row.countedOrders.add(event.orderId);
                }
            }

            return Array.from(campaigns.values()).map(({ countedOrders, ...row }) => row).sort((a, b) => b.sessions - a.sessions).slice(0, 50);
        } catch (error) {
            Logger.error('Analytics Campaigns Error', { error });
            return [];
        }
    }
}
