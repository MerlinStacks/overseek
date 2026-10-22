import { amount, currencyCode, recentOrders, record, trustedAccount } from '../analysisObservations';
import { MultiPeriodAnalyzer, MultiPeriodAnalysis } from '../analyzers/MultiPeriodAnalyzer';

export class MarketingStrategyAdvisor {
    static async analyze(accountId: string, multiPeriod?: MultiPeriodAnalysis) {
        trustedAccount(accountId);
        const [ads, orders] = await Promise.allSettled([multiPeriod ? Promise.resolve(multiPeriod) : MultiPeriodAnalyzer.analyze(accountId), recentOrders(accountId)]);
        let revenue: number | null = null, currency: string | null = null, repeatRate: number | null = null, avgOrderValue: number | null = null;
        let identifiedCustomers = 0;
        if (orders.status === 'fulfilled') {
            const customers = new Map<string, number>(), currencies = new Set<string>(); let total = 0, valid = !orders.value.coverage.truncated;
            for (const order of orders.value.orders) {
                const raw = record(order.rawData), code = currencyCode(raw.currency), value = amount(String(order.total));
                if (!code || value === null) { valid = false; continue; } currencies.add(code); total += value;
                const id = raw.customer_id;
                if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) customers.set(String(id), (customers.get(String(id)) || 0) + 1);
            }
            if (valid && currencies.size === 1 && Number.isFinite(total)) { revenue = total; currency = [...currencies][0]; avgOrderValue = orders.value.orders.length ? total / orders.value.orders.length : null; }
            identifiedCustomers = customers.size;
            if (!orders.value.coverage.truncated && customers.size) repeatRate = [...customers.values()].filter(count => count > 1).length / customers.size * 100;
        }
        return { hasData: revenue !== null || ads.status === 'fulfilled' && ads.value.hasData, recommendations: [],
            suggestions: ['Review observed-order revenue and identified-customer repeat purchases. These are rolling-window associations, not acquisition/retention causality, lifetime value, profitable CPA or a budget recommendation.'],
            summary: { strategicFocus: 'review-observations', seasonalPhase: null, portfolioHealth: null, revenue, currency, avgOrderValue, repeatRate, identifiedCustomers, margin: null },
            coverage: { orders: orders.status === 'fulfilled' ? orders.value.coverage : null, ads: ads.status === 'fulfilled' ? ads.value.coverage : null,
                repeatRateBasis: 'customers-with-multiple-orders / identified-customers-in-observed-window; guests excluded', margin: 'unavailable: current catalog COGS do not establish realized contribution margin' } };
    }
}
