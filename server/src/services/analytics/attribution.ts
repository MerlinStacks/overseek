import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';
import { normalizeSource } from './utils';

export interface AttributionModel {
    name: string;
    sourceBreakdown: Array<{
        source: string;
        revenue: number;
        orders: number;
        credit: number;
    }>;
}

export interface MultiTouchAttribution {
    totalOrders: number;
    totalRevenue: number;
    models: {
        firstTouch: AttributionModel;
        lastTouch: AttributionModel;
        linear: AttributionModel;
        timeDecay: AttributionModel;
        positionBased: AttributionModel;
    };
}

export interface TouchpointJourney {
    avgTouchpoints: number;
    commonSequences: Array<{
        sequence: string;
        count: number;
        percentage: number;
    }>;
    avgTimeToPurchase: number;
}

export class AttributionAnalytics {
    static async getMultiTouchAttribution(
        accountId: string,
        startDate?: string,
        endDate?: string
    ): Promise<MultiTouchAttribution> {
        try {
            const where: any = {
                accountId,
                status: { in: REVENUE_STATUSES }
            };

            if (startDate || endDate) {
                where.dateCreated = {};
                if (startDate) where.dateCreated.gte = new Date(startDate);
                if (endDate) where.dateCreated.lte = new Date(endDate);
            }

            const orders = await prisma.wooOrder.findMany({
                where,
                select: {
                    wooId: true,
                    dateCreated: true,
                    total: true,
                    rawData: true
                },
                take: 50000
            });

            const purchaseEvents = await prisma.analyticsEvent.findMany({
                where: {
                    type: 'purchase',
                    session: { accountId }
                },
                include: {
                    session: {
                        select: {
                            firstTouchSource: true,
                            lastTouchSource: true,
                            utmSource: true,
                            referrer: true,
                            createdAt: true,
                            email: true,
                            wooCustomerId: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: 5000
            });

            const purchaseEventByOrder = new Map<number, typeof purchaseEvents[0]>();
            for (const event of purchaseEvents) {
                const payload = event.payload as any;
                const wooId = payload?.orderId || payload?.order_id;
                if (wooId) {
                    purchaseEventByOrder.set(wooId, event);
                }
            }

            const sessions = await prisma.analyticsSession.findMany({
                where: { accountId },
                select: {
                    id: true,
                    visitorId: true,
                    email: true,
                    wooCustomerId: true,
                    firstTouchSource: true,
                    utmSource: true,
                    referrer: true,
                    createdAt: true
                },
                take: 100000
            });

            const customerSessions = new Map<string, Array<{
                source: string;
                date: Date;
            }>>();

            const emailToWooId = new Map<string, number>();
            for (const order of orders) {
                const rawData = order.rawData as any;
                const email = rawData?.billing?.email?.toLowerCase();
                const wooId = rawData?.customer_id;
                if (email && wooId) {
                    emailToWooId.set(email, wooId);
                }
            }

            for (const session of sessions) {
                let customerKey: string | null = null;
                if (session.email) customerKey = session.email.toLowerCase();
                else if (session.wooCustomerId) customerKey = `woo_${session.wooCustomerId}`;
                else if (session.visitorId) customerKey = `vis_${session.visitorId}`;
                if (!customerKey) continue;

                const source = normalizeSource(session.firstTouchSource || session.utmSource || session.referrer);

                if (!customerSessions.has(customerKey)) {
                    customerSessions.set(customerKey, []);
                }
                customerSessions.get(customerKey)!.push({
                    source,
                    date: session.createdAt
                });
            }

            const orderTouchpoints: Array<{
                orderWooId: number;
                revenue: number;
                orderDate: Date;
                touchpoints: Array<{ source: string; date: Date }>;
            }> = [];

            for (const order of orders) {
                const rawData = order.rawData as any;
                const email = rawData?.billing?.email?.toLowerCase();
                const wooCustomerId = rawData?.customer_id;

                let customerKey: string | null = null;
                if (email) customerKey = email;
                else if (wooCustomerId) customerKey = `woo_${wooCustomerId}`;
                if (!customerKey) continue;

                const sessions = customerSessions.get(customerKey) || [];
                const touchpoints = sessions
                    .filter(s => s.date <= order.dateCreated)
                    .sort((a, b) => a.date.getTime() - b.date.getTime());

                if (touchpoints.length > 0) {
                    orderTouchpoints.push({
                        orderWooId: order.wooId,
                        revenue: Number(order.total),
                        orderDate: order.dateCreated,
                        touchpoints
                    });
                }
            }

            const calculateModel = (creditFn: (touchpoints: Array<{ source: string; date: Date }>, idx: number) => number): AttributionModel => {
                const sourceCredit = new Map<string, { revenue: number; orders: number; credit: number }>();

                for (const order of orderTouchpoints) {
                    const { touchpoints, revenue } = order;
                    let orderCounted = false;

                    for (let i = 0; i < touchpoints.length; i++) {
                        const credit = creditFn(touchpoints, i);
                        const tp = touchpoints[i];

                        if (!sourceCredit.has(tp.source)) {
                            sourceCredit.set(tp.source, { revenue: 0, orders: 0, credit: 0 });
                        }
                        const sc = sourceCredit.get(tp.source)!;
                        sc.credit += credit;
                        sc.revenue += revenue * credit;
                        if (!orderCounted && credit > 0) {
                            sc.orders += 1;
                            orderCounted = true;
                        }
                    }
                }

                return {
                    name: '',
                    sourceBreakdown: Array.from(sourceCredit.entries())
                        .map(([source, data]) => ({
                            source,
                            revenue: Math.round(data.revenue * 100) / 100,
                            orders: data.orders,
                            credit: Math.round(data.credit * 1000) / 1000
                        }))
                        .sort((a, b) => b.revenue - a.revenue)
                };
            };

            const firstTouch = calculateModel((_, idx) => idx === 0 ? 1 : 0);
            const lastTouch = calculateModel((tps, idx) => idx === tps.length - 1 ? 1 : 0);
            const linear = calculateModel((tps) => 1 / tps.length);

            const timeDecay = calculateModel((tps, idx) => {
                if (tps.length <= 1) return 1;
                const decay = 0.9;
                const weights = tps.map((_, i) => Math.pow(decay, tps.length - 1 - i));
                const totalWeight = weights.reduce((a, b) => a + b, 0);
                return weights[idx] / totalWeight;
            });

            const positionBased = calculateModel((tps, idx) => {
                if (tps.length === 1) return 1;
                if (tps.length === 2) return idx === 0 ? 0.5 : 0.5;
                if (idx === 0) return 0.4;
                if (idx === tps.length - 1) return 0.4;
                return 0.2 / (tps.length - 2);
            });

            return {
                totalOrders: orderTouchpoints.length,
                totalRevenue: Math.round(orderTouchpoints.reduce((sum, o) => sum + o.revenue, 0) * 100) / 100,
                models: {
                    firstTouch: { ...firstTouch, name: 'First Touch' },
                    lastTouch: { ...lastTouch, name: 'Last Touch' },
                    linear: { ...linear, name: 'Linear' },
                    timeDecay: { ...timeDecay, name: 'Time Decay' },
                    positionBased: { ...positionBased, name: 'Position Based' }
                }
            };
        } catch (error) {
            Logger.error('[AttributionAnalytics] Multi-touch attribution error', { error, accountId });
            throw error;
        }
    }

    static async getTouchpointJourney(
        accountId: string,
        limit: number = 10
    ): Promise<TouchpointJourney> {
        try {
            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: { in: REVENUE_STATUSES }
                },
                select: {
                    dateCreated: true,
                    rawData: true
                },
                take: 50000
            });

            const sessions = await prisma.analyticsSession.findMany({
                where: { accountId },
                select: {
                    visitorId: true,
                    email: true,
                    wooCustomerId: true,
                    firstTouchSource: true,
                    utmSource: true,
                    referrer: true,
                    createdAt: true
                },
                take: 100000
            });

            const customerSessions = new Map<string, Array<{
                source: string;
                date: Date;
            }>>();

            for (const session of sessions) {
                let customerKey: string | null = null;
                if (session.email) customerKey = session.email.toLowerCase();
                else if (session.wooCustomerId) customerKey = `woo_${session.wooCustomerId}`;
                else if (session.visitorId) customerKey = `vis_${session.visitorId}`;
                if (!customerKey) continue;

                const source = normalizeSource(session.firstTouchSource || session.utmSource || session.referrer);

                if (!customerSessions.has(customerKey)) {
                    customerSessions.set(customerKey, []);
                }
                customerSessions.get(customerKey)!.push({ source, date: session.createdAt });
            }

            let totalTouchpoints = 0;
            let totalConversionTime = 0;
            let conversionCount = 0;
            const sequenceCounts = new Map<string, number>();

            for (const order of orders) {
                const rawData = order.rawData as any;
                const email = rawData?.billing?.email?.toLowerCase();
                const wooCustomerId = rawData?.customer_id;

                let customerKey: string | null = null;
                if (email) customerKey = email;
                else if (wooCustomerId) customerKey = `woo_${wooCustomerId}`;
                if (!customerKey) continue;

                const custSessions = customerSessions.get(customerKey) || [];
                const touchpoints = custSessions
                    .filter(s => s.date <= order.dateCreated)
                    .sort((a, b) => a.date.getTime() - b.date.getTime());

                if (touchpoints.length === 0) continue;

                totalTouchpoints += touchpoints.length;
                conversionCount++;

                const firstTouch = touchpoints[0];
                const timeToPurchase = (order.dateCreated.getTime() - firstTouch.date.getTime()) / (1000 * 60 * 60 * 24);
                totalConversionTime += timeToPurchase;

                const sequence = touchpoints.map(t => t.source).join(' -> ');
                sequenceCounts.set(sequence, (sequenceCounts.get(sequence) || 0) + 1);
            }

            const avgTouchpoints = conversionCount > 0
                ? Math.round((totalTouchpoints / conversionCount) * 100) / 100
                : 0;

            const avgTimeToPurchase = conversionCount > 0
                ? Math.round(totalConversionTime / conversionCount)
                : 0;

            const commonSequences = Array.from(sequenceCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, limit)
                .map(([sequence, count]) => ({
                    sequence,
                    count,
                    percentage: conversionCount > 0 ? Math.round((count / conversionCount) * 100) : 0
                }));

            return { avgTouchpoints, commonSequences, avgTimeToPurchase };
        } catch (error) {
            Logger.error('[AttributionAnalytics] Touchpoint journey error', { error, accountId });
            throw error;
        }
    }
}
