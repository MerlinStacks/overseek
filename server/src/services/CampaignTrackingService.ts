/**
 * Campaign Tracking Service
 * 
 * Handles campaign event tracking for ROI attribution.
 * Records sends, opens, clicks, and purchase attribution.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { normalizeOrderStatus } from '../constants/orderStatus';

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
            const campaignType = params.campaignType || (params.campaignId
                ? await this.resolveCampaignType(params.accountId, params.campaignId)
                : undefined);

            await prisma.campaignEvent.create({
                data: {
                    accountId: params.accountId,
                    campaignId: params.campaignId,
                    campaignType,
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
        const campaignType = await this.resolveCampaignType(accountId, campaignId);
        await this.trackEvent({
            accountId,
            campaignId,
            campaignType,
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
        const campaignType = await this.resolveCampaignType(accountId, campaignId);
        await this.trackEvent({
            accountId,
            campaignId,
            campaignType,
            eventType: 'click',
            recipientEmail,
            linkUrl
        });
    }

    /** Shared by webhooks and sync, including historical revenue recovery. */
    async trackOrderPurchase(accountId: string, order: Record<string, any>): Promise<void> {
        if (!['processing', 'on-hold', 'completed'].includes(normalizeOrderStatus(order.status))) return;
        const email = typeof order.billing?.email === 'string' ? order.billing.email.trim().toLowerCase() : '';
        const revenue = Number(order.total);
        if (!email || !order.id || !Number.isFinite(revenue) || revenue <= 0) return;

        // GMT fields from WooCommerce have no suffix but represent UTC. Never
        // use sync time: it could credit a message sent AFTER the purchase.
        const gmt = order.date_paid_gmt || order.date_created_gmt;
        const rawDate = gmt || order.date_paid || order.date_created;
        if (typeof rawDate !== 'string' || !rawDate.trim()) return;
        const purchasedAt = new Date(gmt && !/(Z|[+-]\d{2}:?\d{2})$/i.test(rawDate) ? `${rawDate}Z` : rawDate);
        if (!Number.isFinite(purchasedAt.getTime()) || purchasedAt.getTime() > Date.now()) return;

        await this.trackPurchase(accountId, String(order.id), revenue, email, undefined, purchasedAt);
    }

    /** Attribute a purchase to a campaign based on UTM or email. */
    async trackPurchase(
        accountId: string,
        orderId: string,
        revenue: number,
        customerEmail: string,
        utmCampaign?: string,
        purchasedAt: Date = new Date()
    ): Promise<void> {
        const normalizedEmail = customerEmail.trim().toLowerCase();
        if (!normalizedEmail || !Number.isFinite(revenue) || revenue <= 0 || !Number.isFinite(purchasedAt.getTime())) return;

        // Try to find the campaign this purchase should be attributed to
        let campaignId = utmCampaign;
        let campaignType: CampaignType | undefined;

        if (!campaignId) {
            // Look for recent sends to this email in the last 7 days
            const recentSend = await prisma.campaignEvent.findFirst({
                where: {
                    accountId,
                    recipientEmail: { equals: normalizedEmail, mode: 'insensitive' },
                    eventType: 'send',
                    campaignId: { not: null },
                    createdAt: {
                        gte: new Date(purchasedAt.getTime() - 7 * 24 * 60 * 60 * 1000),
                        lte: purchasedAt
                    }
                },
                orderBy: { createdAt: 'desc' }
            });

            campaignId = recentSend?.campaignId || undefined;
            campaignType = (recentSend?.campaignType as CampaignType | null) || undefined;
        } else {
            campaignType = await this.resolveCampaignType(accountId, campaignId);
        }

        if (!campaignId) {
            return;
        }
        campaignType ??= await this.resolveCampaignType(accountId, campaignId);

        await prisma.$transaction(async tx => {
            // Webhooks and sync can process the same order concurrently. An
            // account/order lock also prevents retries crediting another flow.
            const key = `campaign-purchase:${accountId}:${orderId}`;
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
            const existingPurchase = await tx.campaignEvent.findFirst({
                where: { accountId, eventType: 'purchase', orderId },
                select: { id: true }
            });
            if (existingPurchase) return;
            await tx.campaignEvent.create({
                data: {
                    accountId, campaignId, campaignType, eventType: 'purchase',
                    recipientEmail: normalizedEmail, orderId, revenue, utmCampaign,
                    createdAt: purchasedAt
                }
            });
        });
    }

    private async resolveCampaignType(accountId: string, campaignId: string): Promise<CampaignType | undefined> {
        const existingEvent = await prisma.campaignEvent.findFirst({
            where: {
                accountId,
                campaignId,
                campaignType: { not: null }
            },
            select: { campaignType: true },
            orderBy: { createdAt: 'desc' }
        });

        if (existingEvent?.campaignType) {
            return existingEvent.campaignType as CampaignType;
        }

        const automation = await prisma.marketingAutomation.findFirst({
            where: { accountId, id: campaignId },
            select: { id: true }
        });
        if (automation) return 'automation';

        const campaign = await prisma.marketingCampaign.findFirst({
            where: { accountId, id: campaignId },
            select: { id: true }
        });
        if (campaign) return 'broadcast';

        return undefined;
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
