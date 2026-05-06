import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

export class CROAnalytics {

    static async getConversionByDevice(accountId: string, startDate?: string, endDate?: string) {
        try {
            return await this.getConversionByDimension(accountId, 'deviceType', startDate, endDate);
        } catch (error) {
            Logger.error('[CROAnalytics] Conversion by device error', { error });
            return [];
        }
    }

    static async getConversionBySource(accountId: string, startDate?: string, endDate?: string) {
        try {
            const dateFilter: any = {};
            if (startDate) dateFilter.gte = new Date(startDate);
            if (endDate) dateFilter.lte = new Date(endDate);

            const sessions = await prisma.analyticsSession.findMany({
                where: {
                    accountId,
                    ...(Object.keys(dateFilter).length > 0 && { lastActiveAt: dateFilter })
                },
                select: { lastTouchSource: true, id: true }
            });

            const purchaseEvents = await prisma.analyticsEvent.findMany({
                where: {
                    session: { accountId },
                    type: 'purchase',
                    ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
                },
                include: { session: { select: { lastTouchSource: true } } }
            });

            const sourceSessions = new Map<string, number>();
            for (const s of sessions) {
                const source = s.lastTouchSource || 'Direct';
                sourceSessions.set(source, (sourceSessions.get(source) || 0) + 1);
            }

            const sourcePurchases = new Map<string, number>();
            for (const event of purchaseEvents) {
                const source = event.session?.lastTouchSource || 'Direct';
                sourcePurchases.set(source, (sourcePurchases.get(source) || 0) + 1);
            }

            const allSources = new Set([...sourceSessions.keys(), ...sourcePurchases.keys()]);

            return Array.from(allSources).map(source => {
                const sessionCount = sourceSessions.get(source) || 0;
                const purchaseCount = sourcePurchases.get(source) || 0;
                return {
                    source,
                    sessions: sessionCount,
                    purchases: purchaseCount,
                    conversionRate: sessionCount > 0 ? Math.round((purchaseCount / sessionCount) * 10000) / 100 : 0
                };
            }).sort((a, b) => b.sessions - a.sessions);
        } catch (error) {
            Logger.error('[CROAnalytics] Conversion by source error', { error });
            return [];
        }
    }

    static async getConversionByBrowser(accountId: string, startDate?: string, endDate?: string) {
        try {
            return await this.getConversionByDimension(accountId, 'browser', startDate, endDate);
        } catch (error) {
            Logger.error('[CROAnalytics] Conversion by browser error', { error });
            return [];
        }
    }

    static async getBounceRate(accountId: string, startDate?: string, endDate?: string) {
        try {
            const dateFilter: any = {};
            if (startDate) dateFilter.gte = new Date(startDate);
            if (endDate) dateFilter.lte = new Date(endDate);

            const totalSessions = await prisma.analyticsSession.count({
                where: { accountId, ...(Object.keys(dateFilter).length > 0 && { lastActiveAt: dateFilter }) }
            });

            if (totalSessions === 0) return { totalSessions: 0, bouncedSessions: 0, bounceRate: 0 };

            const bouncedSessions = await prisma.analyticsSession.count({
                where: {
                    accountId,
                    totalVisits: { lte: 1 },
                    ...(Object.keys(dateFilter).length > 0 && { lastActiveAt: dateFilter })
                }
            });

            return {
                totalSessions,
                bouncedSessions,
                bounceRate: Math.round((bouncedSessions / totalSessions) * 10000) / 100
            };
        } catch (error) {
            Logger.error('[CROAnalytics] Bounce rate error', { error });
            return { totalSessions: 0, bouncedSessions: 0, bounceRate: 0 };
        }
    }

    private static async getConversionByDimension(accountId: string, dimension: 'deviceType' | 'browser', startDate?: string, endDate?: string) {
        const dateFilter: any = {};
        if (startDate) dateFilter.gte = new Date(startDate);
        if (endDate) dateFilter.lte = new Date(endDate);

        const sessions = await prisma.analyticsSession.findMany({
            where: {
                accountId,
                ...(Object.keys(dateFilter).length > 0 && { lastActiveAt: dateFilter })
            },
            select: { id: true, [dimension]: true }
        });

        const purchaseEvents = await prisma.analyticsEvent.findMany({
            where: {
                session: { accountId },
                type: 'purchase',
                ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter })
            },
            include: { session: { select: { id: true, deviceType: true, browser: true } } }
        });

        const dimensionSessions = new Map<string, number>();
        for (const s of sessions) {
            const val = (s as any)[dimension] || 'Unknown';
            dimensionSessions.set(val, (dimensionSessions.get(val) || 0) + 1);
        }

        const dimensionPurchases = new Map<string, number>();
        for (const event of purchaseEvents) {
            const session = event.session as any;
            const val = session?.[dimension] || 'Unknown';
            dimensionPurchases.set(val, (dimensionPurchases.get(val) || 0) + 1);
        }

        const allValues = new Set([...dimensionSessions.keys(), ...dimensionPurchases.keys()]);

        return Array.from(allValues).map(val => {
            const sessionCount = dimensionSessions.get(val) || 0;
            const purchaseCount = dimensionPurchases.get(val) || 0;
            return {
                [dimension]: val,
                sessions: sessionCount,
                purchases: purchaseCount,
                conversionRate: sessionCount > 0 ? Math.round((purchaseCount / sessionCount) * 10000) / 100 : 0
            };
        }).sort((a, b) => b.sessions - a.sessions);
    }
}
