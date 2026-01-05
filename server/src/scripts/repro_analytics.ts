
import { esClient } from '../utils/elastic';

async function runRepro() {
    try {
        const accountId = '2'; // Trying accountId 2 based on recent logs usage pattern or assuming single tenant 
        // Or I should fetch an account first.
        // Let's use wildcard or search a valid account from inspector

        // Find a valid account ID first
        const accRes: any = await esClient.search({ index: 'orders', size: 1 });
        const hit = accRes.hits.hits[0];
        if (!hit) { console.log('No data'); return; }
        const accountIdToUse = hit._source.accountId;
        console.log('Using Account ID:', accountIdToUse);

        const config = {
            dimension: 'day',
            metrics: ['quantity', 'sales']
        };

        const must: any[] = [{ term: { accountId: accountIdToUse } }];

        const aggs: any = {
            group_by_dimension: {
                date_histogram: {
                    field: 'date_created',
                    calendar_interval: 'day',
                    format: 'yyyy-MM-dd'
                },
                aggs: {
                    sales: { sum: { field: 'total' } },
                    quantity_nested: {
                        nested: { path: 'line_items' },
                        aggs: { quantity: { sum: { field: 'line_items.quantity' } } }
                    }
                }
            }
        };

        const response: any = await esClient.search({
            index: 'orders',
            size: 0,
            body: {
                query: { bool: { must } },
                aggs
            }
        });

        const buckets = response.aggregations.group_by_dimension.buckets;
        console.log('Buckets found:', buckets.length);
        if (buckets.length > 0) {
            console.log('First bucket:', JSON.stringify(buckets[0], null, 2));
            // Check quantity
            const b = buckets[0];
            const qty = b.quantity_nested.quantity.value;
            console.log('Quantity:', qty);
        }

    } catch (error: any) {
        console.error('Error:', error.message);
    }
}

runRepro();
