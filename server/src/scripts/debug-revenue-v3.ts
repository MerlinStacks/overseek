
import { esClient } from '../utils/elastic';
import { REVENUE_STATUSES } from '../constants/orderStatus';

const TIMEOUT_MS = 15000;

async function debugRevenueDetailed() {
    try {
        console.log('--- Revenue Debugger Deep Dive ---');

        // 1. Simulating User's "Today"
        // User Time: 2026-01-10T21:30:39+11:00
        // Start of Day (Local): 2026-01-10 00:00:00+11:00
        // UTC Start: 2026-01-09T13:00:00Z

        const start = '2026-01-09T13:00:00.000Z';
        // End of Day (Local): 2026-01-10 23:59:59+11:00
        // UTC End: 2026-01-10T12:59:59.999Z
        const end = '2026-01-10T12:59:59.999Z';

        console.log(`Simulated Query Range (UTC): ${start} to ${end}`);
        console.log(`Statuses: ${REVENUE_STATUSES.join(', ')}`);

        // Find Account ID first
        const initSearch: any = await esClient.search({
            index: 'orders',
            size: 1,
            query: { match_all: {} }
        });
        const accountId = initSearch.hits.hits[0]?._source.accountId;
        if (!accountId) {
            console.log('No orders/account found');
            return;
        }
        console.log(`Using Account: ${accountId}`);

        // Execute Query
        const must: any[] = [
            { term: { accountId } },
            { terms: { 'status': REVENUE_STATUSES } },
            { range: { date_created: { gte: start, lte: end } } }
        ];

        const response: any = await esClient.search({
            index: 'orders',
            size: 100, // Get all orders for today to sum manually
            query: { bool: { must } },
            sort: [{ date_created: { order: 'asc' } } as any]
        });

        const orders = response.hits.hits.map((h: any) => h._source);
        console.log(`\nFound ${orders.length} orders in range.`);

        let manualSum = 0;
        orders.forEach((o: any) => {
            const rawTotal = parseFloat(o.total);
            manualSum += rawTotal;
            console.log(`- [#${o.id}] ${o.date_created} | ${o.status} | $${rawTotal.toFixed(2)}`);
        });

        console.log(`\nManual Sum: $${manualSum.toFixed(2)}`);

        // Compare with "Yesterday" to see if we're accidentally grabbing it?
        // Yesterday Start (Local): Jan 9 00:00:00+11:00 -> Jan 8 13:00:00Z
        // Yesterday End (Local): Jan 9 23:59:59+11:00 -> Jan 9 12:59:59Z
        const yStart = '2026-01-08T13:00:00.000Z';
        const yEnd = '2026-01-09T12:59:59.999Z';

        const yResponse: any = await esClient.search({
            index: 'orders',
            size: 0,
            query: {
                bool: {
                    must: [
                        { term: { accountId } },
                        { terms: { 'status': REVENUE_STATUSES } },
                        { range: { date_created: { gte: yStart, lte: yEnd } } }
                    ]
                }
            },
            aggs: { total: { sum: { field: 'total' } } }
        });
        const yTotal = (yResponse.aggregations as any)?.total?.value || 0;
        console.log(`Yesterday's Total (Simulated): $${yTotal.toFixed(2)}`);
        console.log(`Combined (Yesterday + Today): $${(manualSum + yTotal).toFixed(2)}`);

    } catch (e: any) {
        console.error('Error:', e.message);
    }
}

// Timeout wrapper
Promise.race([
    debugRevenueDetailed(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), TIMEOUT_MS))
]).then(() => {
    console.log('Done.');
    process.exit(0);
}).catch(e => {
    console.error('Fatal Error:', e);
    process.exit(1);
});
