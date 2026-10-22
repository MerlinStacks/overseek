import { prisma } from '../../../utils/prisma';
import { amount, currencyCode, recentOrders, record, trustedAccount } from '../analysisObservations';

export class ProductOpportunityAnalyzer {
    static async analyze(accountId: string, activeAdProductIds?: string[]) {
        trustedAccount(accountId);
        if (activeAdProductIds && (!Array.isArray(activeAdProductIds) || activeAdProductIds.length > 10000 || activeAdProductIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200))) throw new Error('Invalid product coverage sample');
        const [found, observed, account] = await Promise.all([
            prisma.wooProduct.findMany({ where: { accountId }, select: { wooId: true, name: true, sku: true, cogs: true, stockStatus: true, status: true }, orderBy: { wooId: 'asc' }, take: 5001 }), recentOrders(accountId),
            prisma.account.findUnique({ where: { id: accountId }, select: { currency: true } }),
        ]);
        const sales = new Map<number, { units: number; revenue: number; currencies: Set<string>; invalidMoney: boolean }>();
        let invalidLines = 0;
        for (const order of observed.orders) {
            const raw = record(order.rawData), code = currencyCode(raw.currency);
            if (!Array.isArray(raw.line_items) || raw.line_items.length > 1000) { invalidLines++; continue; }
            for (const line of raw.line_items) {
                const item = record(line), id = amount(item.product_id ?? item.productId), quantity = amount(item.quantity), total = amount(item.total);
                if (id === null || !Number.isSafeInteger(id) || id <= 0 || quantity === null || !Number.isSafeInteger(quantity) || quantity <= 0) { invalidLines++; continue; }
                const current = sales.get(id) || { units: 0, revenue: 0, currencies: new Set<string>(), invalidMoney: false };
                current.units += quantity;
                if (total === null || !code) current.invalidMoney = true; else { current.revenue += total; current.currencies.add(code); }
                sales.set(id, current);
            }
        }
        const active = activeAdProductIds ? new Set(activeAdProductIds) : null;
        const candidates = found.slice(0, 5000).flatMap(product => {
            const sale = sales.get(product.wooId);
            if (!sale || !Number.isSafeInteger(sale.units) || product.stockStatus !== 'instock' || product.status !== 'publish') return [];
            const revenue = !sale.invalidMoney && sale.currencies.size === 1 && Number.isFinite(sale.revenue) ? sale.revenue : null;
            const price = revenue !== null ? revenue / sale.units : null, cogs = product.cogs === null ? null : amount(String(product.cogs));
            return [{ productId: String(product.wooId), productName: product.name, sku: product.sku, unitsSold: sale.units, observedUnitsPerDay: sale.units / 30, revenue,
                currency: sale.currencies.size === 1 ? [...sale.currencies][0] : null, averageNetUnitRevenue: price,
                currentCatalogCostMarginIndicator: price !== null && price > 0 && cogs !== null && currencyCode(account?.currency) === [...sale.currencies][0] ? (price - cogs) / price * 100 : null,
                adCoverage: active ? active.has(String(product.wooId)) || !!product.sku && active.has(product.sku) ? 'in-provided-sample' : 'not-in-provided-sample' : 'unknown' }];
        }).sort((a, b) => b.unitsSold - a.unitsSold || a.productId.localeCompare(b.productId)).slice(0, 100);
        return { hasData: candidates.length > 0, unpromotedProducts: [], underperformingProducts: [], highPotentialProducts: [], candidates,
            suggestions: candidates.slice(0, 5).map(product => `Review “${product.productName}”: ${product.unitsSold} units in returned orders. Ad coverage ${product.adCoverage}. Sales are not classified as organic; no sales-lift or advertising budget forecast was made.`),
            summary: { totalProductsAnalyzed: Math.min(found.length, 5000), productsWithSales: candidates.length, productsInAds: active ? active.size : null, opportunityCount: null },
            coverage: { ...observed.coverage, catalogLimit: 5000, catalogTruncated: found.length > 5000, candidateLimit: 100, invalidLines, complete: false,
                marginBasis: 'quantity-weighted observed net unit revenue versus current catalog COGS; not realized contribution profit', adCoverage: active ? 'caller-provided-sample' : 'unavailable' } };
    }
}
