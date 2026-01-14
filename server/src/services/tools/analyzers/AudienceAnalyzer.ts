/**
 * Audience Analyzer
 * 
 * Analyzes performance by device, geography, and other audience dimensions.
 * Provides bid adjustment recommendations based on segment performance.
 * 
 * Part of AI Marketing Co-Pilot Phase 3.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export interface SegmentPerformance {
    segment: string;
    orders: number;
    revenue: number;
    aov: number;
    revenueShare: number;
    performance: 'excellent' | 'good' | 'fair' | 'poor';
    recommendation?: string;
}

export interface DevicePerformance extends SegmentPerformance {
    device: 'mobile' | 'desktop' | 'tablet' | 'unknown';
    bidAdjustment?: number;  // e.g., +20% or -15%
}

export interface GeoPerformance extends SegmentPerformance {
    country: string;
    countryCode?: string;
}

export interface AudienceAnalysis {
    hasData: boolean;

    // Device breakdown
    devicePerformance: DevicePerformance[];
    deviceInsight: string;

    // Geographic breakdown
    geoPerformance: GeoPerformance[];
    geoInsight: string;

    // Time-based patterns (hour of day)
    peakHours: {
        hour: number;
        orders: number;
        revenue: number;
        isOptimal: boolean;
    }[];

    // Recommendations
    bidAdjustments: {
        dimension: 'device' | 'geo' | 'time';
        segment: string;
        currentPerformance: string;
        suggestedAdjustment: number;
        rationale: string;
    }[];

    suggestions: string[];
}

// =============================================================================
// HELPERS
// =============================================================================

function normalizeDevice(device: string | null): 'mobile' | 'desktop' | 'tablet' | 'unknown' {
    if (!device) return 'unknown';
    const d = device.toLowerCase();
    if (d.includes('mobile') || d.includes('phone') || d.includes('ios') || d.includes('android')) return 'mobile';
    if (d.includes('tablet') || d.includes('ipad')) return 'tablet';
    if (d.includes('desktop') || d.includes('windows') || d.includes('mac')) return 'desktop';
    return 'unknown';
}

function assessPerformance(aov: number, avgAov: number): 'excellent' | 'good' | 'fair' | 'poor' {
    const ratio = avgAov > 0 ? aov / avgAov : 1;
    if (ratio >= 1.3) return 'excellent';
    if (ratio >= 1.0) return 'good';
    if (ratio >= 0.7) return 'fair';
    return 'poor';
}

// =============================================================================
// MAIN ANALYZER
// =============================================================================

export class AudienceAnalyzer {

    /**
     * Analyze audience performance by device, geography, and time.
     */
    static async analyze(accountId: string, days: number = 90): Promise<AudienceAnalysis> {
        const result: AudienceAnalysis = {
            hasData: false,
            devicePerformance: [],
            deviceInsight: '',
            geoPerformance: [],
            geoInsight: '',
            peakHours: [],
            bidAdjustments: [],
            suggestions: []
        };

        try {
            const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

            // Get orders with attribution (device, geo from analytics sessions)
            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    dateCreated: { gte: startDate },
                    status: { in: ['completed', 'processing'] }
                },
                select: {
                    wooId: true,
                    total: true,
                    dateCreated: true,
                    rawData: true
                }
            });

            if (orders.length === 0) return result;

            // Get analytics sessions for device/geo enrichment
            const purchaseEvents = await prisma.analyticsEvent.findMany({
                where: {
                    session: { accountId },
                    type: 'purchase',
                    createdAt: { gte: startDate }
                },
                include: {
                    session: {
                        select: {
                            deviceType: true,
                            country: true,
                            city: true
                        }
                    }
                }
            });

            // Build order -> analytics map
            const orderAnalyticsMap = new Map<number, {
                device: string | null;
                country: string | null;
            }>();

            for (const event of purchaseEvents) {
                const orderId = (event.payload as any)?.orderId;
                if (orderId && event.session) {
                    orderAnalyticsMap.set(Number(orderId), {
                        device: event.session.deviceType,
                        country: event.session.country
                    });
                }
            }

            // Aggregate by device
            const deviceData = new Map<string, { orders: number; revenue: number }>();
            const geoData = new Map<string, { orders: number; revenue: number }>();
            const hourData = new Map<number, { orders: number; revenue: number }>();
            let totalRevenue = 0;
            let totalOrders = 0;

            for (const order of orders) {
                const total = parseFloat(String(order.total)) || 0;
                totalRevenue += total;
                totalOrders++;

                // Get analytics data or fallback to order data
                const analytics = orderAnalyticsMap.get(order.wooId);
                const rawData = order.rawData as any;

                // Device
                const device = normalizeDevice(analytics?.device || null);
                const deviceStats = deviceData.get(device) || { orders: 0, revenue: 0 };
                deviceStats.orders++;
                deviceStats.revenue += total;
                deviceData.set(device, deviceStats);

                // Geography - prefer analytics, fallback to billing country
                const country = analytics?.country || rawData?.billing?.country || 'Unknown';
                const geoStats = geoData.get(country) || { orders: 0, revenue: 0 };
                geoStats.orders++;
                geoStats.revenue += total;
                geoData.set(country, geoStats);

                // Hour of day
                const orderHour = new Date(order.dateCreated).getHours();
                const hourStats = hourData.get(orderHour) || { orders: 0, revenue: 0 };
                hourStats.orders++;
                hourStats.revenue += total;
                hourData.set(orderHour, hourStats);
            }

            const avgAov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

            // Process device performance
            result.devicePerformance = Array.from(deviceData.entries())
                .map(([device, data]) => {
                    const aov = data.orders > 0 ? data.revenue / data.orders : 0;
                    const performance = assessPerformance(aov, avgAov);

                    return {
                        segment: device,
                        device: device as DevicePerformance['device'],
                        orders: data.orders,
                        revenue: Math.round(data.revenue * 100) / 100,
                        aov: Math.round(aov * 100) / 100,
                        revenueShare: totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 1000) / 10 : 0,
                        performance,
                        bidAdjustment: this.calculateBidAdjustment(aov, avgAov)
                    };
                })
                .sort((a, b) => b.revenue - a.revenue);

            // Process geo performance
            result.geoPerformance = Array.from(geoData.entries())
                .map(([country, data]) => {
                    const aov = data.orders > 0 ? data.revenue / data.orders : 0;
                    return {
                        segment: country,
                        country,
                        orders: data.orders,
                        revenue: Math.round(data.revenue * 100) / 100,
                        aov: Math.round(aov * 100) / 100,
                        revenueShare: totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 1000) / 10 : 0,
                        performance: assessPerformance(aov, avgAov)
                    };
                })
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 10); // Top 10 countries

            // Process peak hours
            const maxHourOrders = Math.max(...Array.from(hourData.values()).map(h => h.orders), 1);
            result.peakHours = Array.from(hourData.entries())
                .map(([hour, data]) => ({
                    hour,
                    orders: data.orders,
                    revenue: Math.round(data.revenue * 100) / 100,
                    isOptimal: data.orders >= maxHourOrders * 0.7
                }))
                .sort((a, b) => a.hour - b.hour);

            result.hasData = true;

            // Generate insights
            this.generateDeviceInsight(result, avgAov);
            this.generateGeoInsight(result);
            this.generateBidAdjustments(result, avgAov);
            this.generateSuggestions(result);

        } catch (error) {
            Logger.error('AudienceAnalyzer failed', { error, accountId });
        }

        return result;
    }

    /**
     * Calculate suggested bid adjustment based on performance vs average.
     */
    private static calculateBidAdjustment(segmentAov: number, avgAov: number): number {
        if (avgAov === 0) return 0;
        const ratio = segmentAov / avgAov;

        // Cap adjustments at +50% / -50%
        if (ratio >= 1.5) return 50;
        if (ratio >= 1.3) return 30;
        if (ratio >= 1.1) return 15;
        if (ratio >= 0.9) return 0;
        if (ratio >= 0.7) return -15;
        if (ratio >= 0.5) return -30;
        return -50;
    }

    /**
     * Generate device performance insight.
     */
    private static generateDeviceInsight(result: AudienceAnalysis, avgAov: number): void {
        const mobile = result.devicePerformance.find(d => d.device === 'mobile');
        const desktop = result.devicePerformance.find(d => d.device === 'desktop');

        if (mobile && desktop && mobile.orders >= 10 && desktop.orders >= 10) {
            const mobileAov = mobile.aov;
            const desktopAov = desktop.aov;

            if (desktopAov > mobileAov * 1.3) {
                result.deviceInsight = `Desktop has ${Math.round((desktopAov / mobileAov - 1) * 100)}% higher AOV ($${desktopAov} vs $${mobileAov}). Consider higher bids for desktop.`;
            } else if (mobileAov > desktopAov * 1.3) {
                result.deviceInsight = `Mobile has ${Math.round((mobileAov / desktopAov - 1) * 100)}% higher AOV ($${mobileAov} vs $${desktopAov}). Your audience converts better on mobile.`;
            } else {
                result.deviceInsight = `Device performance is balanced. Mobile: $${mobileAov} AOV, Desktop: $${desktopAov} AOV.`;
            }
        } else if (mobile && mobile.revenueShare > 70) {
            result.deviceInsight = `${mobile.revenueShare}% of revenue from mobile. Ensure mobile experience is optimized.`;
        } else if (desktop && desktop.revenueShare > 70) {
            result.deviceInsight = `${desktop.revenueShare}% of revenue from desktop. Consider if mobile experience needs improvement.`;
        }
    }

    /**
     * Generate geographic insight.
     */
    private static generateGeoInsight(result: AudienceAnalysis): void {
        if (result.geoPerformance.length === 0) return;

        const top = result.geoPerformance[0];
        const topShare = top.revenueShare;

        if (topShare > 80) {
            result.geoInsight = `${topShare}% of revenue from ${top.country}. Consider expansion opportunities.`;
        } else if (result.geoPerformance.length >= 3) {
            const top3 = result.geoPerformance.slice(0, 3);
            const top3Share = top3.reduce((sum, g) => sum + g.revenueShare, 0);
            result.geoInsight = `Top 3 markets (${top3.map(g => g.country).join(', ')}) represent ${top3Share.toFixed(0)}% of revenue.`;
        }
    }

    /**
     * Generate bid adjustment recommendations.
     */
    private static generateBidAdjustments(result: AudienceAnalysis, avgAov: number): void {
        // Device bid adjustments
        for (const device of result.devicePerformance) {
            if (device.orders < 10) continue; // Need enough data
            if (device.bidAdjustment && device.bidAdjustment !== 0) {
                result.bidAdjustments.push({
                    dimension: 'device',
                    segment: device.device,
                    currentPerformance: `$${device.aov} AOV (${device.performance})`,
                    suggestedAdjustment: device.bidAdjustment,
                    rationale: device.bidAdjustment > 0
                        ? `${device.device} has higher AOV than average - increase bids to capture more`
                        : `${device.device} underperforms - reduce bids or improve experience`
                });
            }
        }

        // Geo bid adjustments for top performers
        for (const geo of result.geoPerformance.slice(0, 5)) {
            if (geo.orders < 5) continue;
            const adjustment = this.calculateBidAdjustment(geo.aov, avgAov);
            if (adjustment >= 20) {
                result.bidAdjustments.push({
                    dimension: 'geo',
                    segment: geo.country,
                    currentPerformance: `$${geo.aov} AOV (${geo.performance})`,
                    suggestedAdjustment: adjustment,
                    rationale: `${geo.country} has strong AOV - consider geo-targeting expansion`
                });
            }
        }
    }

    /**
     * Generate audience-based suggestions.
     */
    private static generateSuggestions(result: AudienceAnalysis): void {
        const { devicePerformance, geoPerformance, peakHours, bidAdjustments, deviceInsight, geoInsight } = result;

        // Device insight
        if (deviceInsight) {
            result.suggestions.push(`📱 **Device Performance**: ${deviceInsight}`);
        }

        // Geo insight
        if (geoInsight) {
            result.suggestions.push(`🌍 **Geographic Performance**: ${geoInsight}`);
        }

        // High-performing device bid recommendation
        const highPerfDevice = bidAdjustments.find(b => b.dimension === 'device' && b.suggestedAdjustment >= 20);
        if (highPerfDevice) {
            result.suggestions.push(
                `📈 **Bid Opportunity**: ${highPerfDevice.segment} ${highPerfDevice.currentPerformance}. ` +
                `Consider +${highPerfDevice.suggestedAdjustment}% bid adjustment.`
            );
        }

        // Underperforming device warning
        const lowPerfDevice = bidAdjustments.find(b => b.dimension === 'device' && b.suggestedAdjustment <= -20);
        if (lowPerfDevice) {
            result.suggestions.push(
                `⚠️ **${lowPerfDevice.segment} Underperforming**: ${lowPerfDevice.currentPerformance}. ` +
                `Consider ${lowPerfDevice.suggestedAdjustment}% bid adjustment or UX improvements.`
            );
        }

        // Peak hours insight
        const peakHoursList = peakHours.filter(h => h.isOptimal);
        if (peakHoursList.length > 0 && peakHoursList.length < 12) {
            const hours = peakHoursList.map(h =>
                `${h.hour.toString().padStart(2, '0')}:00`
            ).join(', ');
            result.suggestions.push(
                `⏰ **Peak Buying Hours**: Most orders between ${hours}. Consider ad scheduling to optimize spend.`
            );
        }

        // Geo expansion opportunity
        const highPerfGeo = geoPerformance.find(g => g.performance === 'excellent' && g.revenueShare < 30);
        if (highPerfGeo) {
            result.suggestions.push(
                `🎯 **Expansion Opportunity**: ${highPerfGeo.country} has excellent AOV ($${highPerfGeo.aov}) ` +
                `but only ${highPerfGeo.revenueShare}% revenue share. Consider increasing targeting.`
            );
        }
    }
}
