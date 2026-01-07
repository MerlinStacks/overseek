import { esClient } from '../../utils/elastic';

async function verifyOrders() {
    try {
        console.log('Connecting to ES...');
        const health = await esClient.cluster.health();
        console.log('Cluster Health:', health.status);

        const query = {
            bool: {
                must: [
                    { terms: { 'status.keyword': ['completed', 'processing', 'on-hold'] } },
                    { range: { date_created: { gte: '2026-01-05T00:00:00', lte: '2026-01-05T23:59:59' } } }
                ]
            }
        };

        console.log('Testing specific query:', JSON.stringify(query, null, 2));

        const response = await esClient.search({
            index: 'orders',
            size: 10,
            body: { query }
        });

        const getTotal = (res: any) => res.hits.total.value || res.hits.total;

        console.log(`Query matches: ${getTotal(response)}`);
        response.hits.hits.forEach((hit: any) => {
            console.log(`Matched: ${hit._source.id} - ${hit._source.status} - ${hit._source.date_created}`);
        });

        // Also check if status.keyword works at all
        const keywordCheck = await esClient.search({
            index: 'orders',
            size: 1,
            body: { query: { term: { 'status.keyword': 'processing' } } }
        });
        console.log(`Status.keyword 'processing' check matches: ${getTotal(keywordCheck)}`);

        // Check if plain status works
        const textCheck = await esClient.search({
            index: 'orders',
            size: 1,
            body: { query: { match: { 'status': 'processing' } } }
        });
        console.log(`Status (text) 'processing' check matches: ${getTotal(textCheck)}`);

    } catch (error) {
        console.error('Error:', error);
    }
}

verifyOrders();
