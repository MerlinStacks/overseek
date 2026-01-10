
import { esClient } from '../utils/elastic';
import { prisma } from '../utils/prisma';

async function debugRevenueV5() {
    try {
        console.log('--- Revenue Debugger V5 ---');

        console.log('Checking Prism connection...');
        const count = await prisma.wooOrder.count();
        console.log(`Prisma Orders: ${count}`);

        console.log('Checking ElasticSearch...');
        const info = await esClient.info();
        console.log(`ES Version: ${info.version.number}`);

        // 1. Get Account ID
        const initSearch: any = await esClient.search({
            index: 'orders',
            size: 1,
            query: { match_all: {} }
        });

        const hits = initSearch.hits.hits;
        if (hits.length === 0) {
            console.log('No orders found at all in ES.');
            return;
        }

        const accountId = hits[0]._source.accountId;
        console.log(`Using Account: ${accountId}`);

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
        console.log('ID | Date Created (Raw) | Status | Total');
        orders.forEach((o: any) => {
            console.log(`${o.id} | ${o.date_created} | ${o.status} | ${o.total}`);
        });

    } catch (e: any) {
        console.error('FULL ERROR:', JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
    }
}

debugRevenueV5().then(() => process.exit(0));
