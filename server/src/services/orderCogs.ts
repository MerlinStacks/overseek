/**
 * Order COGS Service
 *
 * Resolves per-line-item COGS for a single order.
 * Resolves explicit variant overrides, falling back to the product only when
 * the override is absent, then adds miscellaneous costs.
 */

import { prisma } from '../utils/prisma';
import { sumMiscCosts } from '../utils/miscCosts';

function finite(value: number): number {
    if (!Number.isFinite(value)) throw new RangeError('Order cost calculation exceeds numeric range');
    return value;
}

function numeric(value: unknown, label: string): number {
    const result = typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) ? Number(value) : NaN;
    if (!Number.isFinite(result)) throw new Error(`Invalid ${label}`);
    return result;
}

function wooId(value: unknown): number {
    const id = numeric(value ?? 0, 'product or variation ID');
    if (!Number.isSafeInteger(id) || id < 0) throw new Error('Invalid product or variation ID');
    return id;
}

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
    if (!accountId?.trim()) throw new Error('Account ID required');
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) throw new Error('Invalid order data');
    if (rawData.line_items !== undefined && !Array.isArray(rawData.line_items)) throw new Error('Invalid order line items');
    const lineItems = ((rawData.line_items ?? []) as unknown[]).map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid order line item');
        const item = value as Record<string, unknown>;
        return { product_id: wooId(item.product_id), variation_id: wooId(item.variation_id), quantity: numeric(item.quantity ?? 0, 'quantity'), total: numeric(item.total ?? 0, 'line revenue'), name: typeof item.name === 'string' ? item.name : 'Unknown' };
    });

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
            select: { wooId: true, cogs: true, miscCosts: true, sku: true, product: { select: { wooId: true } } }
        })
    ]);

    const productMap = new Map(products.map(p => [p.wooId, p]));
    const variationMap = new Map(variations.map(v => [`${v.product.wooId}:${v.wooId}`, v]));

    // 3. Resolve COGS per line item
    let totalCOGS = 0;
    let totalRevenue = 0;
    const items: COGSLineItem[] = [];

    for (const item of lineItems) {
        const pid: number = item.product_id || 0;
        const vid: number = item.variation_id || 0;
        const quantity: number = item.quantity || 0;
        const revenue = item.total;

        let unitCOGS = 0;
        let sku = '';
        let miscCostsSource: unknown = null;

        const variation = variationMap.get(`${pid}:${vid}`);
        const product = productMap.get(pid);
        // Zero is an explicit override. Only missing variation costs inherit the parent.
        const source = variation?.cogs != null ? variation : product;
        unitCOGS = source?.cogs == null ? 0 : finite(Number(source.cogs));
        sku = variation?.sku || product?.sku || '';
        miscCostsSource = variation && Array.isArray(variation.miscCosts) && variation.miscCosts.length ? variation.miscCosts : source?.miscCosts;
        unitCOGS = finite(unitCOGS + sumMiscCosts(miscCostsSource));

        const lineCOGS = finite(unitCOGS * quantity);
        totalCOGS = finite(totalCOGS + lineCOGS);
        totalRevenue = finite(totalRevenue + revenue);

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
    if (rawData.meta_data !== undefined && !Array.isArray(rawData.meta_data)) throw new Error('Invalid order metadata');
    const metaData = (rawData.meta_data ?? []) as Array<{ key?: unknown; value?: unknown } | null>;
    for (const meta of metaData) {
        if (meta && typeof meta.key === 'string' && PAYMENT_FEE_KEYS.includes(meta.key) && meta.value != null && meta.value !== '') {
            paymentFees = finite(paymentFees + numeric(meta.value, 'payment fee'));
        }
    }

    const grossProfit = finite(totalRevenue - totalCOGS - paymentFees);
    const margin = totalRevenue > 0 ? finite((grossProfit / totalRevenue) * 100) : 0;

    return { items, totalCOGS, totalRevenue, paymentFees, grossProfit, margin };
}
