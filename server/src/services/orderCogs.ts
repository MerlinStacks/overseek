/**
 * Order COGS Service
 *
 * Resolves per-line-item COGS for a single order.
 * Mirrors the resolution logic from ProfitabilityReportService
 * (variant → product fallback, plus miscCosts).
 */

import { prisma } from '../utils/prisma';
import { sumMiscCosts } from '../utils/miscCosts';

interface COGSLineItem {
    productId: number;
    variationId: number;
    name: string;
    sku: string;
    quantity: number;
    unitCOGS: number;
    lineCOGS: number;
    lineRevenue: number;
}

interface OrderCOGSResult {
    items: COGSLineItem[];
    totalCOGS: number;
    totalRevenue: number;
    paymentFees: number;
    grossProfit: number;
    margin: number;
}

/** Payment-fee meta keys recognised by WooCommerce payment gateways */
const PAYMENT_FEE_KEYS = [
    '_stripe_fee',
    '_paypal_transaction_fee',
    '_wcpay_transaction_fee',
    '_transaction_fee'
];

/**
 * Resolves COGS for every line item in a single order.
 *
 * @param accountId - Tenant scope
 * @param rawData   - The WooCommerce rawData JSON from the wooOrder record
 * @returns Breakdown per line item plus order-level totals
 */
export async function getOrderCOGS(
    accountId: string,
    rawData: Record<string, unknown>
): Promise<OrderCOGSResult> {
    const lineItems = (rawData.line_items as any[]) || [];

    // 1. Collect IDs for batch DB lookup
    const productIds = new Set<number>();
    const variationIds = new Set<number>();

    for (const item of lineItems) {
        if (item.product_id) productIds.add(item.product_id);
        if (item.variation_id) variationIds.add(item.variation_id);
    }

    // 2. Batch-fetch product and variation COGS
    const [products, variations] = await Promise.all([
        prisma.wooProduct.findMany({
            where: { accountId, wooId: { in: Array.from(productIds) } },
            select: { wooId: true, cogs: true, miscCosts: true, name: true, sku: true }
        }),
        prisma.productVariation.findMany({
            where: {
                product: { accountId },
                wooId: { in: Array.from(variationIds) }
            },
            select: { wooId: true, cogs: true, miscCosts: true, sku: true }
        })
    ]);

    const productMap = new Map(products.map(p => [p.wooId, p]));
    const variationMap = new Map(variations.map(v => [v.wooId, v]));

    // 3. Resolve COGS per line item
    let totalCOGS = 0;
    let totalRevenue = 0;
    const items: COGSLineItem[] = [];

    for (const item of lineItems) {
        const pid: number = item.product_id || 0;
        const vid: number = item.variation_id || 0;
        const quantity: number = item.quantity || 0;
        const revenue = parseFloat(item.total || '0');

        let unitCOGS = 0;
        let sku = '';
        let miscCostsSource: unknown = null;

        // Prefer variation COGS
        if (vid && variationMap.has(vid)) {
            const v = variationMap.get(vid)!;
            unitCOGS = v.cogs ? Number(v.cogs) : 0;
            sku = v.sku || '';
            miscCostsSource = v.miscCosts;
        }

        // Fallback to product if variation COGS is zero or not found
        if (unitCOGS === 0 && productMap.has(pid)) {
            const p = productMap.get(pid)!;
            unitCOGS = p.cogs ? Number(p.cogs) : 0;

            if (!miscCostsSource || (Array.isArray(miscCostsSource) && miscCostsSource.length === 0)) {
                miscCostsSource = p.miscCosts;
            }
            if (!sku) sku = p.sku || '';
        } else if (!sku && productMap.has(pid)) {
            sku = productMap.get(pid)!.sku || '';
        }

        unitCOGS += sumMiscCosts(miscCostsSource);

        const lineCOGS = unitCOGS * quantity;
        totalCOGS += lineCOGS;
        totalRevenue += revenue;

        items.push({
            productId: pid,
            variationId: vid,
            name: item.name || 'Unknown',
            sku,
            quantity,
            unitCOGS,
            lineCOGS,
            lineRevenue: revenue
        });
    }

    // 4. Extract payment processing fees
    let paymentFees = 0;
    const metaData = (rawData.meta_data as any[]) || [];
    for (const meta of metaData) {
        if (PAYMENT_FEE_KEYS.includes(meta.key) && meta.value) {
            const fee = parseFloat(meta.value);
            if (!isNaN(fee)) paymentFees += fee;
        }
    }

    const grossProfit = totalRevenue - totalCOGS - paymentFees;
    const margin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    return { items, totalCOGS, totalRevenue, paymentFees, grossProfit, margin };
}
