/**
 * Customer Cohort Analysis Service
 * 
 * Provides order-based customer cohort analysis including:
 * - Customer retention cohorts (by first purchase month)
 * - Acquisition source cohorts (Google Ads vs Organic)
 * - Product-based cohorts (by first purchased product line)
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { REVENUE_STATUSES } from '../../constants/orderStatus';
import {
    monthsDifference,
    normalizeSource,
    inferCategory,
    ANALYTICS_CONFIG,
    extractBillingInfo,
    extractCustomerId
} from './utils';

export interface RetentionCohort {
    cohortMonth: string; // "2026-01"
    totalCustomers: number;
    retention: Array<{
        monthsAfter: number;
        activeCustomers: number;
        retentionRate: number;
    }>;
}

export interface SourceCohort {
    source: string;
    totalCustomers: number;
    totalRevenue: number;
    avgLTV: number;
    repeatRate: number;
    retention: Array<{
        monthsAfter: number;
        activeCustomers: number;
        retentionRate: number;
    }>;
}

export interface ProductCohort {
    productCategory: string;
    totalCustomers: number;
    totalRevenue: number;
    avgOrderValue: number;
    repeatRate: number;
}

export class CustomerCohortService {

    /**
     * Get customer retention cohorts by first purchase month
     * Returns a matrix showing what % of customers from each cohort made repeat purchases
     */
    static async getRetentionCohorts(accountId: string, monthsBack: number = 6): Promise<RetentionCohort[]> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);
            cutoffDate.setDate(1);
            cutoffDate.setHours(0, 0, 0, 0);

            // Get all orders with customer info
            // Limit to 50,000 orders to prevent memory issues for very large stores
            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: { in: REVENUE_STATUSES },
                    dateCreated: { gte: cutoffDate }
                },
                select: {
                    id: true,
                    wooId: true,
                    dateCreated: true,
                    total: true,
                    rawData: true
                },
                orderBy: { dateCreated: 'asc' },
                take: 50000
            });

            // Group orders by customer email
            const customerOrders = new Map<string, Array<{ date: Date; total: number }>>();

            for (const order of orders) {
                const rawData = order.rawData as any;
                const email = rawData?.billing?.email?.toLowerCase();
                if (!email) continue;

                if (!customerOrders.has(email)) {
                    customerOrders.set(email, []);
                }
                customerOrders.get(email)!.push({
                    date: order.dateCreated,
                    total: Number(order.total)
                });
            }

            // Build cohorts by first purchase month
            const cohortMap = new Map<string, {
                customers: Set<string>;
                returnedByMonth: Map<number, Set<string>>;
            }>();

            for (const [email, emailOrders] of customerOrders) {
                if (emailOrders.length === 0) continue;

                // Sort by date
                emailOrders.sort((a, b) => a.date.getTime() - b.date.getTime());
                const firstOrder = emailOrders[0];
                const cohortKey = `${firstOrder.date.getFullYear()}-${String(firstOrder.date.getMonth() + 1).padStart(2, '0')}`;

                if (!cohortMap.has(cohortKey)) {
                    cohortMap.set(cohortKey, {
                        customers: new Set(),
                        returnedByMonth: new Map()
                    });
                }

                const cohort = cohortMap.get(cohortKey)!;
                cohort.customers.add(email);

                // Track return visits by month offset
                for (let i = 1; i < emailOrders.length; i++) {
                    const subsequentOrder = emailOrders[i];
                    const monthsDiff = monthsDifference(firstOrder.date, subsequentOrder.date);

                    if (monthsDiff > 0 && monthsDiff <= 12) {
                        if (!cohort.returnedByMonth.has(monthsDiff)) {
                            cohort.returnedByMonth.set(monthsDiff, new Set());
                        }
                        cohort.returnedByMonth.get(monthsDiff)!.add(email);
                    }
                }
            }

            // Convert to output format
            const cohorts: RetentionCohort[] = [];
            const sortedKeys = Array.from(cohortMap.keys()).sort();

            for (const cohortMonth of sortedKeys) {
                const data = cohortMap.get(cohortMonth)!;
                const totalCustomers = data.customers.size;

                const retention: Array<{ monthsAfter: number; activeCustomers: number; retentionRate: number }> = [];

                // Track cumulative retention
                const retainedCustomers = new Set<string>();

                for (let month = 1; month <= 6; month++) {
                    const monthReturners = data.returnedByMonth.get(month) || new Set();
                    monthReturners.forEach(c => retainedCustomers.add(c));

                    retention.push({
                        monthsAfter: month,
                        activeCustomers: retainedCustomers.size,
                        retentionRate: totalCustomers > 0
                            ? Math.round((retainedCustomers.size / totalCustomers) * 100)
                            : 0
                    });
                }

                cohorts.push({
                    cohortMonth,
                    totalCustomers,
                    retention
                });
            }

            return cohorts;
        } catch (error) {
            Logger.error('[CustomerCohortService] Retention cohort error', { error, accountId });
            throw error;
        }
    }

    /**
     * Get customer cohorts by acquisition source (UTM/referrer)
     * Uses session attribution data linked to customers
     */
    static async getAcquisitionCohorts(accountId: string): Promise<SourceCohort[]> {
        try {
            // Get sessions with purchase attribution
            // Limit to last 6 months for performance
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

            const sessions = await prisma.analyticsSession.findMany({
                where: {
                    accountId,
                    wooCustomerId: { not: null },
                    createdAt: { gte: sixMonthsAgo }
                },
                select: {
                    wooCustomerId: true,
                    firstTouchSource: true,
                    utmSource: true,
                    referrer: true,
                    createdAt: true
                },
                take: 100000
            });

            // Get all orders by customer
            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: { in: REVENUE_STATUSES }
                },
                select: {
                    wooId: true,
                    dateCreated: true,
                    total: true,
                    rawData: true
                }
            });

            // Map customers to their source
            const customerSource = new Map<number, string>();
            for (const session of sessions) {
                if (!session.wooCustomerId) continue;
                const source = normalizeSource(session.firstTouchSource || session.utmSource || session.referrer);
                if (!customerSource.has(session.wooCustomerId)) {
                    customerSource.set(session.wooCustomerId, source);
                }
            }

            // Group orders by customer and source
            const sourceData = new Map<string, {
                customers: Set<number>;
                revenue: number;
                ordersByCustomer: Map<number, number>;
            }>();

            for (const order of orders) {
                const rawData = order.rawData as any;
                const customerId = rawData?.customer_id;
                if (!customerId) continue;

                const source = customerSource.get(customerId) || 'Unknown';

                if (!sourceData.has(source)) {
                    sourceData.set(source, {
                        customers: new Set(),
                        revenue: 0,
                        ordersByCustomer: new Map()
                    });
                }

                const data = sourceData.get(source)!;
                data.customers.add(customerId);
                data.revenue += Number(order.total);
                data.ordersByCustomer.set(customerId, (data.ordersByCustomer.get(customerId) || 0) + 1);
            }

            // Convert to output format
            const cohorts: SourceCohort[] = [];

            for (const [source, data] of sourceData) {
                const totalCustomers = data.customers.size;
                const repeatCustomers = Array.from(data.ordersByCustomer.values()).filter(c => c > 1).length;

                cohorts.push({
                    source,
                    totalCustomers,
                    totalRevenue: Math.round(data.revenue * 100) / 100,
                    avgLTV: totalCustomers > 0 ? Math.round((data.revenue / totalCustomers) * 100) / 100 : 0,
                    repeatRate: totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100) : 0,
                    retention: [] // Would need monthly tracking for full retention curve
                });
            }

            return cohorts.sort((a, b) => b.totalRevenue - a.totalRevenue);
        } catch (error) {
            Logger.error('[CustomerCohortService] Acquisition cohort error', { error, accountId });
            throw error;
        }
    }

    /**
     * Get product-based cohorts (customers grouped by first purchased product category)
     */
    static async getProductCohorts(accountId: string): Promise<ProductCohort[]> {
        try {
            // Get all orders with line items
            // Limit to 50,000 orders for memory safety
            const orders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: { in: REVENUE_STATUSES }
                },
                select: {
                    wooId: true,
                    dateCreated: true,
                    total: true,
                    rawData: true
                },
                orderBy: { dateCreated: 'asc' },
                take: 50000
            });

            // Track first product category per customer
            const customerFirstCategory = new Map<string, {
                category: string;
                firstOrderDate: Date;
            }>();

            const categoryData = new Map<string, {
                customers: Set<string>;
                revenue: number;
                orderCount: number;
                ordersByCustomer: Map<string, number>;
            }>();

            for (const order of orders) {
                const rawData = order.rawData as any;
                const email = rawData?.billing?.email?.toLowerCase();
                if (!email) continue;

                const lineItems = rawData?.line_items || [];

                // Get first category from line items
                let category = 'Uncategorized';
                for (const item of lineItems) {
                    if (item.category_name || item.meta_data?.find((m: any) => m.key === 'category')) {
                        category = item.category_name ||
                            item.meta_data?.find((m: any) => m.key === 'category')?.value ||
                            'Uncategorized';
                        break;
                    }
                    // Try product name as fallback for categorization
                    if (item.name) {
                        // Simple heuristic: use first word or predefined patterns
                        category = inferCategory(item.name);
                    }
                }

                // Track first category for this customer
                if (!customerFirstCategory.has(email)) {
                    customerFirstCategory.set(email, {
                        category,
                        firstOrderDate: order.dateCreated
                    });
                }

                const firstCategory = customerFirstCategory.get(email)!.category;

                if (!categoryData.has(firstCategory)) {
                    categoryData.set(firstCategory, {
                        customers: new Set(),
                        revenue: 0,
                        orderCount: 0,
                        ordersByCustomer: new Map()
                    });
                }

                const data = categoryData.get(firstCategory)!;
                data.customers.add(email);
                data.revenue += Number(order.total);
                data.orderCount++;
                data.ordersByCustomer.set(email, (data.ordersByCustomer.get(email) || 0) + 1);
            }

            // Convert to output format
            const cohorts: ProductCohort[] = [];

            for (const [category, data] of categoryData) {
                const totalCustomers = data.customers.size;
                const repeatCustomers = Array.from(data.ordersByCustomer.values()).filter(c => c > 1).length;

                cohorts.push({
                    productCategory: category,
                    totalCustomers,
                    totalRevenue: Math.round(data.revenue * 100) / 100,
                    avgOrderValue: data.orderCount > 0 ? Math.round((data.revenue / data.orderCount) * 100) / 100 : 0,
                    repeatRate: totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100) : 0
                });
            }

            return cohorts.sort((a, b) => b.totalRevenue - a.totalRevenue);
        } catch (error) {
            Logger.error('[CustomerCohortService] Product cohort error', { error, accountId });
            throw error;
        }
    }
}
