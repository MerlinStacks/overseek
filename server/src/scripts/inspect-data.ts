
import { esClient } from '../utils/elastic';

async function inspectData() {
    try {
        console.log('Searching for one order...');
        const response: any = await esClient.search({
            index: 'orders',
            size: 1,
            body: {
                query: { match_all: {} }
            }
        });

        // v8 response structure handling
        const hits = response.hits ? response.hits.hits : (response.body ? response.body.hits.hits : []);

        if (hits.length > 0) {
            const source = hits[0]._source;
            console.log('Order ID:', source.id);
            console.log('Total:', source.total);
            console.log('Line Items:', JSON.stringify(source.line_items, null, 2));
        } else {
            console.log('No orders found.');
        }

    } catch (error: any) {
        console.error('Error inspecting data:', error.message);
    }
}

inspectData();
