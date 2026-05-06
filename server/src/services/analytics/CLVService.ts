import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';
import type { Prisma } from '@prisma/client';
import { normalizeSource } from './utils';

export interface CLVDashboard {
    averageCLV: number;
    medianCLV: number;
    distribution: {
        label: string;
        count: number;
        percentage: number;
    }[];
    newVsReturning: {
        newCustomers: number;
        returningCustomers: number;
        ratio: number;
    };
    tenureDistribution: {
        tenureDays: string;
        count: number;
        avgCLV: number;
    }[];
    clvBySource: {
        source: string;
        customerCount: number;
        avgCLV: number;
        totalRevenue: number;
    }[];
    monthlyTrend: {
        month: string;
        avgCLV: number;
        customerCount: number;
    }[];
}

export class CLVService {
    async getCLVDashboard(accountId: string, monthsBack: number = 12): Promise<CLVDashboard> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);
            cutoffDate.setDate(1);
            cutoffDate.setHours(0, 0, 0, 0);

            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: { in: REVENUE_STATUSES },
                    dateCreated: { gte: cutoffDate }
                },
                select: {
                    id: true,
                    dateCreated: true,
                    total: true,
                    rawData: true
                },
                orderBy: { dateCreated: 'asc' },
                take: 50000
            });

            const customerOrders = new Map<string, {
                orders: Array<{ date: Date; total: number }>;
                email: string;
            }>();

            for (const order of orders) {
                const rawData = order.rawData as Prisma.JsonObject | null;
                const billing = typeof rawData?.billing === 'object' && rawData?.billing !== null ? (rawData.billing as Prisma.JsonObject) : null;
                const email = typeof billing?.email === 'string' ? billing.email.toLowerCase() : undefined;
                if (!email) continue;

                if (!customerOrders.has(email)) {
                    customerOrders.set(email, { orders: [], email });
                }
                customerOrders.get(email)!.orders.push({
                    date: order.dateCreated,
                    total: Number(order.total)
                });
            }

            const customerCLVs = new Map<string, {
                clv: number;
                orderCount: number;
                firstOrderDate: Date;
                lastOrderDate: Date;
            }>();

            for (const [email, data] of customerOrders) {
                const sortedOrders = data.orders.sort((a, b) => a.date.getTime() - b.date.getTime());
                const totalRevenue = sortedOrders.reduce((sum, o) => sum + o.total, 0);

                customerCLVs.set(email, {
                    clv: totalRevenue,
                    orderCount: sortedOrders.length,
                    firstOrderDate: sortedOrders[0].date,
                    lastOrderDate: sortedOrders[sortedOrders.length - 1].date
                });
            }

            const clvValues = Array.from(customerCLVs.values()).map(c => c.clv);
            const sortedCLVs = [...clvValues].sort((a, b) => a - b);

            const averageCLV = clvValues.length > 0
                ? Math.round((clvValues.reduce((a, b) => a + b, 0) / clvValues.length) * 100) / 100
                : 0;

            const medianCLV = sortedCLVs.length > 0
                ? sortedCLVs.length % 2 === 0
                    ? Math.round(((sortedCLVs[sortedCLVs.length / 2 - 1] + sortedCLVs[sortedCLVs.length / 2]) / 2) * 100) / 100
                    : Math.round(sortedCLVs[Math.floor(sortedCLVs.length / 2)] * 100) / 100
                : 0;

            const distribution = [
                { label: '0-100', min: 0, max: 100 },
                { label: '100-500', min: 100, max: 500 },
                { label: '500-1000', min: 500, max: 1000 },
                { label: '1000+', min: 1000, max: Infinity }
            ].map(bucket => {
                const count = clvValues.filter(v => v >= bucket.min && v < bucket.max).length;
                return {
                    label: bucket.label,
                    count,
                    percentage: clvValues.length > 0 ? Math.round((count / clvValues.length) * 100) : 0
                };
            });

            const newCustomers = Array.from(customerCLVs.values()).filter(c => c.orderCount === 1).length;
            const returningCustomers = Array.from(customerCLVs.values()).filter(c => c.orderCount > 1).length;

            const tenureBuckets = [
                { label: '0-30 days', min: 0, max: 30 },
                { label: '31-90 days', min: 31, max: 90 },
                { label: '91-180 days', min: 91, max: 180 },
                { label: '181-365 days', min: 181, max: 365 },
                { label: '365+ days', min: 365, max: Infinity }
            ];

            const tenureDistribution = tenureBuckets.map(bucket => {
                const customers = Array.from(customerCLVs.values()).filter(c => {
                    const tenureDays = Math.floor((new Date().getTime() - c.firstOrderDate.getTime()) / (1000 * 60 * 60 * 24));
                    return tenureDays >= bucket.min && tenureDays < bucket.max;
                });
                const avgCLV = customers.length > 0
                    ? Math.round((customers.reduce((sum, c) => sum + c.clv, 0) / customers.length) * 100) / 100
                    : 0;
                return {
                    tenureDays: bucket.label,
                    count: customers.length,
                    avgCLV
                };
            });

            const sessions = await prisma.analyticsSession.findMany({
                where: {
                    accountId,
                    wooCustomerId: { not: null },
                    createdAt: { gte: cutoffDate }
                },
                select: {
                    wooCustomerId: true,
                    firstTouchSource: true,
                    utmSource: true,
                    referrer: true
                },
                take: 100000
            });

            const customerSource = new Map<string, string>();
            const emailToCustomerId = new Map<number, string>();

            for (const [email, data] of customerOrders) {
                const rawData = orders.find((o) => {
                    const r = o.rawData as Prisma.JsonObject | null;
                    const billing = typeof r?.billing === 'object' && r?.billing !== null ? (r.billing as Prisma.JsonObject) : null;
                    const bEmail = typeof billing?.email === 'string' ? billing.email.toLowerCase() : undefined;
                    return bEmail === email;
                })?.rawData as Prisma.JsonObject | null;
                const customerId = typeof rawData?.customer_id === 'number' ? rawData.customer_id : undefined;
                if (customerId != null) {
                    emailToCustomerId.set(customerId, email);
                }
            }

            for (const session of sessions) {
                if (!session.wooCustomerId) continue;
                const email = emailToCustomerId.get(session.wooCustomerId);
                if (!email) continue;
                const source = normalizeSource(session.firstTouchSource || session.utmSource || session.referrer);
                if (!customerSource.has(email)) {
                    customerSource.set(email, source);
                }
            }

            const sourceData = new Map<string, { customers: number; revenue: number }>();

            for (const [email, data] of customerCLVs) {
                const source = customerSource.get(email) || 'Direct';
                if (!sourceData.has(source)) {
                    sourceData.set(source, { customers: 0, revenue: 0 });
                }
                const sd = sourceData.get(source)!;
                sd.customers++;
                sd.revenue += data.clv;
            }

            const clvBySource = Array.from(sourceData.entries()).map(([source, data]) => ({
                source,
                customerCount: data.customers,
                totalRevenue: Math.round(data.revenue * 100) / 100,
                avgCLV: data.customers > 0 ? Math.round((data.revenue / data.customers) * 100) / 100 : 0
            })).sort((a, b) => b.totalRevenue - a.totalRevenue);

            const monthlyCLVMap = new Map<string, { totalCLV: number; count: number }>();

            for (const [email, data] of customerCLVs) {
                const monthKey = `${data.firstOrderDate.getFullYear()}-${String(data.firstOrderDate.getMonth() + 1).padStart(2, '0')}`;
                if (!monthlyCLVMap.has(monthKey)) {
                    monthlyCLVMap.set(monthKey, { totalCLV: 0, count: 0 });
                }
                const m = monthlyCLVMap.get(monthKey)!;
                m.totalCLV += data.clv;
                m.count++;
            }

            const monthlyTrend = Array.from(monthlyCLVMap.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([month, data]) => ({
                    month,
                    avgCLV: data.count > 0 ? Math.round((data.totalCLV / data.count) * 100) / 100 : 0,
                    customerCount: data.count
                }));

            return {
                averageCLV,
                medianCLV,
                distribution,
                newVsReturning: {
                    newCustomers,
                    returningCustomers,
                    ratio: newCustomers + returningCustomers > 0
                        ? Math.round((returningCustomers / (newCustomers + returningCustomers)) * 100)
                        : 0
                },
                tenureDistribution,
                clvBySource,
                monthlyTrend
            };
        } catch (error) {
            Logger.error('[CLVService] CLV dashboard error', { error, accountId });
            throw error;
        }
    }
}

export const clvService = new CLVService();
