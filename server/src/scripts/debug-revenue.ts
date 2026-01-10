
import { esClient } from '../utils/elastic';

const TIMEOUT_MS = 10000;

async function debugRevenue() {
    try {
        console.log('--- Order Debugger v2 ---');
        console.log('ELASTICSEARCH_URL:', process.env.ELASTICSEARCH_URL);
        console.log('Fetching recent orders...');

        // 1. Fetch raw recent orders
        const response: any = await esClient.search({
            index: 'orders',
            size: 20,
            sort: [{ date_created: { order: 'desc' } } as any],
            query: { match_all: {} }
        });

        const hits = response.hits.hits;
        console.log(`Found ${hits.length} orders.`);

        const accounts = new Set<string>();

        if (hits.length > 0) {
            console.log('Sample Data (Last 5):');
            hits.slice(0, 5).forEach((hit: any) => {
                const s = hit._source;
                accounts.add(s.accountId);
                console.log(`[${s.id}] Date: ${s.date_created} | Status: '${s.status}' | Total: ${s.total} | Account: ${s.accountId}`);
            });
        } else {
            console.log('No orders found in index!');
        }

        if (accounts.size === 0) return;
        const accountId = Array.from(accounts)[0];
        console.log(`\nUsing Account ID: ${accountId} for query test`);

        // 2. Simulate "Today"
        const now = new Date();
        // Construct "Today" UTC range (User is UTC+11)
        // Similar to dateUtils.ts: getStartOfDayUTC
        // Local Now: 2026-01-10 ~20:45
        // Start of Day Local: 2026-01-10 00:00:00 -> UTC: 2026-01-09 13:00:00

        // Emulate Client Logic
        // We can't easily emulate client timezone here without a lib, but let's approximate.
        // We'll just define the range manually that COVERS the recent orders we saw above if any.

        const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const end = now.toISOString();

        console.log(`Query Range: ${start} to ${end}`);

        const must: any[] = [
            { term: { accountId } },
            { terms: { 'status': ['completed', 'processing', 'on-hold'] } },
            {
                range: {
                    date_created: {
                        gte: start,
                        lte: end
                    }
                }
            }
        ];

        console.log('Executing Revenue Query...');
        const queryRes: any = await esClient.search({
            index: 'orders',
            size: 0,
            query: { bool: { must } },
            aggs: { total_sales: { sum: { field: 'total' } } }
        });

        console.log('Query Result (Total Sales):', (queryRes.aggregations as any)?.total_sales?.value);

        // 3. Debug Status Aggregation
        console.log('\nFetching Status Distribution...');
        const statusAggRes: any = await esClient.search({
            index: 'orders',
            size: 0,
            query: { term: { accountId } },
            aggs: {
                statuses: {
                    terms: { field: 'status.keyword', size: 20 }
                }
            }
        });

        console.log('\nStatus Distribution (status.keyword):');
        const buckets = (statusAggRes.aggregations as any)?.statuses?.buckets || [];
        buckets.forEach((b: any) => {
            console.log(`'${b.key}': ${b.doc_count}`);
        });

    } catch (e: any) {
        console.error('Error:', e.message);
    }
}

// Timeout wrapper
Promise.race([
    debugRevenue(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), TIMEOUT_MS))
]).then(() => {
    console.log('Done.');
    process.exit(0);
}).catch(e => {
    console.error('Fatal Error:', e);
    process.exit(1);
});
