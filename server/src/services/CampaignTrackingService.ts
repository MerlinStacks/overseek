/**
 * Campaign Tracking Service
 * 
 * Handles campaign event tracking for ROI attribution.
 * Records sends, opens, clicks, and purchase attribution.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

type EventType = 'send' | 'open' | 'click' | 'unsubscribe' | 'purchase';
type CampaignType = 'automation' | 'broadcast' | 'one-off';

interface TrackEventParams {
    accountId: string;
    campaignId?: string;
    campaignType?: CampaignType;
    eventType: EventType;
    recipientEmail?: string;
    recipientPhone?: string;
    linkUrl?: string;
    orderId?: string;
    revenue?: number;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    metadata?: any;
}

interface CampaignAnalytics {
    sends: number;
    opens: number;
    clicks: number;
    unsubscribes: number;
    purchases: number;
    revenue: number;
    openRate: number;
    clickRate: number;
    conversionRate: number;
}

export class CampaignTrackingService {

    /**
     * Track a campaign event.
     */
    async trackEvent(params: TrackEventParams): Promise<void> {
        try {
            await prisma.campaignEvent.create({
                data: {
                    accountId: params.accountId,
                    campaignId: params.campaignId,
                    campaignType: params.campaignType,
                    eventType: params.eventType,
                    recipientEmail: params.recipientEmail,
                    recipientPhone: params.recipientPhone,
                    linkUrl: params.linkUrl,
                    orderId: params.orderId,
                    revenue: params.revenue,
                    utmSource: params.utmSource,
                    utmMedium: params.utmMedium,
                    utmCampaign: params.utmCampaign,
                    metadata: params.metadata
                }
            });
        } catch (error) {
            Logger.error('Failed to track campaign event', { error, params });
        }
    }

    /**
     * Track email send event.
     */
    async trackSend(
        accountId: string,
        campaignId: string,
        campaignType: CampaignType,
        recipientEmail: string
    ): Promise<void> {
        await this.trackEvent({
            accountId,
            campaignId,
            campaignType,
            eventType: 'send',
            recipientEmail
        });
    }

    /**
     * Track email open event (called from tracking pixel).
     */
    async trackOpen(
        accountId: string,
        campaignId: string,
        recipientEmail: string
    ): Promise<void> {
        await this.trackEvent({
            accountId,
            campaignId,
            eventType: 'open',
            recipientEmail
        });
    }

    /**
     * Track link click event.
     */
    async trackClick(
        accountId: string,
        campaignId: string,
        recipientEmail: string,
        linkUrl: string
    ): Promise<void> {
        await this.trackEvent({
            accountId,
            campaignId,
            eventType: 'click',
            recipientEmail,
            linkUrl
        });
    }

    /**
     * Attribute a purchase to a campaign based on UTM or email.
     */
    async trackPurchase(
        accountId: string,
        orderId: string,
        revenue: number,
        customerEmail: string,
        utmCampaign?: string
    ): Promise<void> {
        // Try to find the campaign this purchase should be attributed to
        let campaignId = utmCampaign;

        if (!campaignId) {
            // Look for recent sends to this email in the last 7 days
            const recentSend = await prisma.campaignEvent.findFirst({
                where: {
                    accountId,
                    recipientEmail: customerEmail,
                    eventType: 'send',
                    createdAt: {
                        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                    }
                },
                orderBy: { createdAt: 'desc' }
            });

            campaignId = recentSend?.campaignId || undefined;
        }

        await this.trackEvent({
            accountId,
            campaignId,
            eventType: 'purchase',
            recipientEmail: customerEmail,
            orderId,
            revenue,
            utmCampaign
        });
    }

    /**
     * Get analytics for a specific campaign.
     */
    async getCampaignAnalytics(
        accountId: string,
        campaignId: string
    ): Promise<CampaignAnalytics> {
        const events = await prisma.campaignEvent.groupBy({
            by: ['eventType'],
            where: { accountId, campaignId },
            _count: true,
            _sum: { revenue: true }
        });

        const stats: Record<string, { count: number; revenue: number }> = {};
        for (const e of events) {
            stats[e.eventType] = {
                count: e._count,
                revenue: e._sum.revenue || 0
            };
        }

        const sends = stats['send']?.count || 0;
        const opens = stats['open']?.count || 0;
        const clicks = stats['click']?.count || 0;
        const unsubscribes = stats['unsubscribe']?.count || 0;
        const purchases = stats['purchase']?.count || 0;
        const revenue = stats['purchase']?.revenue || 0;

        return {
            sends,
            opens,
            clicks,
            unsubscribes,
            purchases,
            revenue,
            openRate: sends > 0 ? (opens / sends) * 100 : 0,
            clickRate: sends > 0 ? (clicks / sends) * 100 : 0,
            conversionRate: sends > 0 ? (purchases / sends) * 100 : 0
        };
    }

    /**
     * Get overall campaign performance for an account.
     */
    async getAccountCampaignOverview(
        accountId: string,
        days: number = 30
    ): Promise<{
        totalSends: number;
        totalOpens: number;
        totalClicks: number;
        totalRevenue: number;
        avgOpenRate: number;
        avgClickRate: number;
    }> {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const events = await prisma.campaignEvent.groupBy({
            by: ['eventType'],
            where: {
                accountId,
                createdAt: { gte: since }
            },
            _count: true,
            _sum: { revenue: true }
        });

        const stats: Record<string, { count: number; revenue: number }> = {};
        for (const e of events) {
            stats[e.eventType] = {
                count: e._count,
                revenue: e._sum.revenue || 0
            };
        }

        const sends = stats['send']?.count || 0;
        const opens = stats['open']?.count || 0;
        const clicks = stats['click']?.count || 0;
        const revenue = stats['purchase']?.revenue || 0;

        return {
            totalSends: sends,
            totalOpens: opens,
            totalClicks: clicks,
            totalRevenue: revenue,
            avgOpenRate: sends > 0 ? (opens / sends) * 100 : 0,
            avgClickRate: sends > 0 ? (clicks / sends) * 100 : 0
        };
    }
}

// Singleton instance
export const campaignTrackingService = new CampaignTrackingService();
