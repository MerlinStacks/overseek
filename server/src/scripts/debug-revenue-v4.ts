
import { esClient } from '../utils/elastic';

const TIMEOUT_MS = 15000;

async function debugRevenueV4() {
    try {
        console.log('--- Revenue Debugger V4 ---');

        // 1. Get Account ID
        const initSearch: any = await esClient.search({
            index: 'orders',
            size: 1,
            query: { match_all: {} }
        });

        const hits = initSearch.hits.hits;
        if (hits.length === 0) {
            console.log('No orders found at all.');
            return;
        }

        const accountId = hits[0]._source.accountId;
        console.log(`Using Account: ${accountId}`);

        // 2. Query for a wide range to see "Yesterday" and "Today" orders
        // User Local Now: Jan 10 21:30
        // Window Start: Jan 9 13:00 UTC

        // Let's just look at the last 20 orders sorted by date
        const response: any = await esClient.search({
            index: 'orders',
            size: 20,
            query: {
                bool: {
                    must: [
                        { term: { accountId } }
                    ]
                }
            },
            sort: [{ date_created: { order: 'desc' } } as any]
        });

        const orders = response.hits.hits.map((h: any) => h._source);

        console.log('\nRecent Orders (Last 20):');
        console.log('ID | Date Created (Raw) | Status | Total');
        console.log('---|---|---|---');

        orders.forEach((o: any) => {
            console.log(`${o.id} | ${o.date_created} | ${o.status} | ${o.total}`);
        });

        // 3. Test "Today" Query Range Calculation (Manual)
        const start = '2026-01-09T13:00:00.000Z'; // Jan 10 00:00 Local
        console.log(`\nChecking filtering against "Today" Start: ${start}`);

        let acceptedTotal = 0;
        let rejectedTotal = 0;

        orders.forEach((o: any) => {
            // lexical string comparison works for ISO dates
            if (o.date_created >= start) {
                if (['completed', 'processing', 'on-hold', 'pending'].includes(o.status.toLowerCase())) {
                    acceptedTotal += parseFloat(o.total);
                    console.log(`[INCLUDED] ${o.id} (${o.date_created}) $${o.total}`);
                } else {
                    console.log(`[SKIPPED-STATUS] ${o.id} (${o.status})`);
                }
            } else {
                if (['completed', 'processing', 'on-hold', 'pending'].includes(o.status.toLowerCase())) {
                    rejectedTotal += parseFloat(o.total);
                    console.log(`[EXCLUDED-DATE] ${o.id} (${o.date_created}) $${o.total}`);
                }
            }
        });

        console.log(`\nManual Sum of Visible Recent Orders IN Range: $${acceptedTotal.toFixed(2)}`);
        console.log(`Sum of Visible Recent Orders OUT of Range: $${rejectedTotal.toFixed(2)}`);

    } catch (e: any) {
        console.error('Error:', e.message);
    }
}

debugRevenueV4().then(() => process.exit(0)).catch(() => process.exit(1));
