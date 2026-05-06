import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';

export interface RepeatPurchaseRate {
    totalCustomers: number;
    repeatCustomers: number;
    repeatPurchaseRate: number;
    avgOrdersPerCustomer: number;
}

export interface RetentionCohortRow {
    cohortMonth: string;
    totalCustomers: number;
    retention: Array<{
        monthOffset: number;
        activeCustomers: number;
        retentionRate: number;
    }>;
}

export interface ChurnRate {
    monthlyChurn: Array<{
        month: string;
        churnRate: number;
        activeCustomers: number;
        churnedCustomers: number;
    }>;
    rolling3MonthAvg: number;
}

export class RetentionAnalytics {
    static async getRepeatPurchaseRate(
        accountId: string,
        startDate?: string,
        endDate?: string
    ): Promise<RepeatPurchaseRate> {
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
                    dateCreated: true,
                    total: true,
                    rawData: true
                },
                take: 50000
            });

            const customerOrderCount = new Map<string, number>();

            for (const order of orders) {
                const rawData = order.rawData as any;
                const email = rawData?.billing?.email?.toLowerCase();
                if (!email) continue;

                customerOrderCount.set(email, (customerOrderCount.get(email) || 0) + 1);
            }

            const totalCustomers = customerOrderCount.size;
            const repeatCustomers = Array.from(customerOrderCount.values()).filter(c => c >= 2).length;
            const totalOrders = Array.from(customerOrderCount.values()).reduce((sum, c) => sum + c, 0);

            return {
                totalCustomers,
                repeatCustomers,
                repeatPurchaseRate: totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 1000) / 10 : 0,
                avgOrdersPerCustomer: totalCustomers > 0 ? Math.round((totalOrders / totalCustomers) * 100) / 100 : 0
            };
        } catch (error) {
            Logger.error('[RetentionAnalytics] Repeat purchase rate error', { error, accountId });
            throw error;
        }
    }

    static async getRetentionCohort(
        accountId: string,
        monthsBack: number = 6
    ): Promise<RetentionCohortRow[]> {
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
                    dateCreated: true,
                    total: true,
                    rawData: true
                },
                orderBy: { dateCreated: 'asc' },
                take: 50000
            });

            const customerOrders = new Map<string, Date[]>();

            for (const order of orders) {
                const rawData = order.rawData as any;
                const email = rawData?.billing?.email?.toLowerCase();
                if (!email) continue;

                if (!customerOrders.has(email)) {
                    customerOrders.set(email, []);
                }
                customerOrders.get(email)!.push(order.dateCreated);
            }

            const cohortMap = new Map<string, {
                customers: Set<string>;
                returnedByMonth: Map<number, Set<string>>;
            }>();

            for (const [email, orderDates] of customerOrders) {
                if (orderDates.length === 0) continue;

                orderDates.sort((a, b) => a.getTime() - b.getTime());
                const firstOrder = orderDates[0];
                const cohortKey = `${firstOrder.getFullYear()}-${String(firstOrder.getMonth() + 1).padStart(2, '0')}`;

                if (!cohortMap.has(cohortKey)) {
                    cohortMap.set(cohortKey, {
                        customers: new Set(),
                        returnedByMonth: new Map()
                    });
                }

                const cohort = cohortMap.get(cohortKey)!;
                cohort.customers.add(email);

                for (let i = 1; i < orderDates.length; i++) {
                    const monthsDiff = (orderDates[i].getFullYear() - firstOrder.getFullYear()) * 12
                        + (orderDates[i].getMonth() - firstOrder.getMonth());

                    if (monthsDiff > 0 && monthsDiff <= 12) {
                        if (!cohort.returnedByMonth.has(monthsDiff)) {
                            cohort.returnedByMonth.set(monthsDiff, new Set());
                        }
                        cohort.returnedByMonth.get(monthsDiff)!.add(email);
                    }
                }
            }

            const cohorts: RetentionCohortRow[] = [];
            const sortedKeys = Array.from(cohortMap.keys()).sort();

            for (const cohortMonth of sortedKeys) {
                const data = cohortMap.get(cohortMonth)!;
                const totalCustomers = data.customers.size;

                const retainedCustomers = new Set<string>();
                const retention: Array<{ monthOffset: number; activeCustomers: number; retentionRate: number }> = [];

                for (let month = 1; month <= 6; month++) {
                    const monthReturners = data.returnedByMonth.get(month) || new Set();
                    monthReturners.forEach(c => retainedCustomers.add(c));

                    retention.push({
                        monthOffset: month,
                        activeCustomers: retainedCustomers.size,
                        retentionRate: totalCustomers > 0
                            ? Math.round((retainedCustomers.size / totalCustomers) * 1000) / 10
                            : 0
                    });
                }

                cohorts.push({ cohortMonth, totalCustomers, retention });
            }

            return cohorts;
        } catch (error) {
            Logger.error('[RetentionAnalytics] Retention cohort error', { error, accountId });
            throw error;
        }
    }

    static async getChurnRate(
        accountId: string,
        monthsBack: number = 6
    ): Promise<ChurnRate> {
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
                    dateCreated: true,
                    rawData: true
                },
                take: 50000
            });

            const customerMonthlyActivity = new Map<string, Set<string>>();

            for (const order of orders) {
                const rawData = order.rawData as any;
                const email = rawData?.billing?.email?.toLowerCase();
                if (!email) continue;

                const monthKey = `${order.dateCreated.getFullYear()}-${String(order.dateCreated.getMonth() + 1).padStart(2, '0')}`;

                if (!customerMonthlyActivity.has(email)) {
                    customerMonthlyActivity.set(email, new Set());
                }
                customerMonthlyActivity.get(email)!.add(monthKey);
            }

            const allMonths = new Set<string>();
            for (const activeMonths of customerMonthlyActivity.values()) {
                activeMonths.forEach(m => allMonths.add(m));
            }
            const sortedMonths = Array.from(allMonths).sort();

            const monthlyChurn: Array<{
                month: string;
                churnRate: number;
                activeCustomers: number;
                churnedCustomers: number;
            }> = [];

            for (let i = 0; i < sortedMonths.length; i++) {
                const currentMonth = sortedMonths[i];
                const prevMonth = i > 0 ? sortedMonths[i - 1] : null;

                if (!prevMonth) {
                    monthlyChurn.push({
                        month: currentMonth,
                        churnRate: 0,
                        activeCustomers: customerMonthlyActivity.size,
                        churnedCustomers: 0
                    });
                    continue;
                }

                const prevActiveCustomers = new Set<string>();
                const currentActiveCustomers = new Set<string>();

                for (const [email, activeMonths] of customerMonthlyActivity) {
                    if (activeMonths.has(prevMonth)) {
                        prevActiveCustomers.add(email);
                    }
                    if (activeMonths.has(currentMonth)) {
                        currentActiveCustomers.add(email);
                    }
                }

                const churnedCount = prevActiveCustomers.size -
                    Array.from(prevActiveCustomers).filter(c => currentActiveCustomers.has(c)).length;

                monthlyChurn.push({
                    month: currentMonth,
                    churnRate: prevActiveCustomers.size > 0
                        ? Math.round((churnedCount / prevActiveCustomers.size) * 1000) / 10
                        : 0,
                    activeCustomers: currentActiveCustomers.size,
                    churnedCustomers: churnedCount
                });
            }

            const last3Months = monthlyChurn.slice(-3);
            const rolling3MonthAvg = last3Months.length > 0
                ? Math.round((last3Months.reduce((sum, m) => sum + m.churnRate, 0) / last3Months.length) * 10) / 10
                : 0;

            return { monthlyChurn, rolling3MonthAvg };
        } catch (error) {
            Logger.error('[RetentionAnalytics] Churn rate error', { error, accountId });
            throw error;
        }
    }
}
