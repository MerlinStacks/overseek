/**
 * Profitability Report Service
 * 
 * Calculates Gross Profit based on COGS for orders within a date range.
 * Extracted from AnalyticsService.ts for maintainability.
 */

import { prisma } from '../utils/prisma';
import { sumMiscCosts } from '../utils/miscCosts';

interface LineItem {
    orderId: string;
    orderNumber: string;
    date: Date;
    productId: number;
    variationId: number;
    name: string;
    quantity: number;
    revenue: number;
}

interface ProfitabilityBreakdown extends LineItem {
    sku: string;
    cogsUnit: number;
    cost: number;
    profit: number;
    margin: number;
}

interface ProfitabilityReport {
    summary: {
        revenue: number;
        cost: number;
        paymentFees: number;
        profit: number;
        margin: number;
    };
    breakdown: ProfitabilityBreakdown[];
}

/**
 * Get Profitability Report
 * Calculates Gross Profit based on COGS for orders in the given date range.
 */
export async function getProfitabilityReport(
    accountId: string,
    startDate: Date,
    endDate: Date
): Promise<ProfitabilityReport> {
    // Fetch Orders in range
    const orders = await prisma.wooOrder.findMany({
        where: {
            accountId,
            dateCreated: { gte: startDate, lte: endDate },
            status: { in: ['completed', 'processing'] }
        },
        select: {
            id: true,
            wooId: true,
            number: true,
            dateCreated: true,
            rawData: true
        }
    });

    // Collect IDs to batch fetch COGS
    const productIds = new Set<number>();
    const variationIds = new Set<number>();
    const lineItemsMap: LineItem[] = [];

    for (const order of orders) {
        const raw = order.rawData as any;
        if (!raw.line_items) continue;

        for (const item of raw.line_items) {
            const pid = item.product_id;
            const vid = item.variation_id || 0;

            if (pid) productIds.add(pid);
            if (vid) variationIds.add(vid);

            const revenue = parseFloat(item.total || '0');

            lineItemsMap.push({
                orderId: order.id,
                orderNumber: order.number,
                date: order.dateCreated,
                productId: pid,
                variationId: vid,
                name: item.name,
                quantity: item.quantity,
                revenue
            });
        }
    }

    // Batch fetch COGS - Products
    const products = await prisma.wooProduct.findMany({
        where: { accountId, wooId: { in: Array.from(productIds) } },
        select: { wooId: true, cogs: true, miscCosts: true, name: true, sku: true }
    });
    const productMap = new Map(products.map(p => [p.wooId, p]));

    // Batch fetch COGS - Variations
    const variations = await prisma.productVariation.findMany({
        where: {
            product: { accountId },
            wooId: { in: Array.from(variationIds) }
        },
        select: { wooId: true, cogs: true, miscCosts: true, sku: true }
    });
    const variationMap = new Map(variations.map(v => [v.wooId, v]));

    // Match & Calculate
    let totalRevenue = 0;
    let totalCost = 0;
    const breakdown: ProfitabilityBreakdown[] = [];

    for (const line of lineItemsMap) {
        let cogsUnit = 0;
        let sku = '';
        let miscCostsSource: unknown = null;

        // Try Variation first
        if (line.variationId && variationMap.has(line.variationId)) {
            const v = variationMap.get(line.variationId)!;
            cogsUnit = v.cogs ? Number(v.cogs) : 0;
            sku = v.sku || '';
            miscCostsSource = v.miscCosts;
        }
        // Fallback to Product
        else if (productMap.has(line.productId)) {
            const p = productMap.get(line.productId)!;
            if (cogsUnit === 0) {
                cogsUnit = p.cogs ? Number(p.cogs) : 0;
                if (!sku) sku = p.sku || '';
            }
            miscCostsSource = p.miscCosts;
        }

        // Add miscellaneous costs (shipping, packaging, etc.) to COGS
        cogsUnit += sumMiscCosts(miscCostsSource);

        const cost = cogsUnit * line.quantity;
        const profit = line.revenue - cost;
        const margin = line.revenue > 0 ? (profit / line.revenue) * 100 : 0;

        totalRevenue += line.revenue;
        totalCost += cost;

        breakdown.push({
            ...line,
            sku,
            cogsUnit,
            cost,
            profit,
            margin
        });
    }

    // Calculate Payment Fees from Orders
    let totalPaymentFees = 0;
    const paymentFeeKeys = ['_stripe_fee', '_paypal_transaction_fee', '_wcpay_transaction_fee', '_transaction_fee'];

    for (const order of orders) {
        const raw = order.rawData as any;
        if (raw.meta_data && Array.isArray(raw.meta_data)) {
            for (const meta of raw.meta_data) {
                if (paymentFeeKeys.includes(meta.key) && meta.value) {
                    const fee = parseFloat(meta.value);
                    if (!isNaN(fee)) {
                        totalPaymentFees += fee;
                    }
                }
            }
        }
    }

    const totalProfit = totalRevenue - totalCost - totalPaymentFees;
    const totalMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    return {
        summary: {
            revenue: totalRevenue,
            cost: totalCost,
            paymentFees: totalPaymentFees,
            profit: totalProfit,
            margin: totalMargin
        },
        breakdown: breakdown.sort((a, b) => b.date.getTime() - a.date.getTime())
    };
}
