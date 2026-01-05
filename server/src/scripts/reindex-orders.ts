
import { PrismaClient } from '@prisma/client';
import { IndexingService } from '../services/search/IndexingService';
import { esClient } from '../utils/elastic';
import { Logger } from '../utils/logger';

const prisma = new PrismaClient();

async function reindexAll() {
    try {
        console.log('Starting full reindex of Orders...');

        // 1. Delete existing index
        try {
            const exists = await esClient.indices.exists({ index: 'orders' });
            if (exists) {
                console.log('Deleting existing orders index...');
                await esClient.indices.delete({ index: 'orders' });
            }
        } catch (e: any) {
            console.warn('Error verifying/deleting index:', e.message);
        }

        // 2. Initialize (Creates index with new mapping)
        await IndexingService.initializeIndices();
        console.log('Indices initialized.');

        // 3. Fetch all Orders
        const count = await prisma.wooOrder.count();
        console.log(`Found ${count} orders in database.`);

        const batchSize = 50;
        let processed = 0;

        while (processed < count) {
            const orders = await prisma.wooOrder.findMany({
                take: batchSize,
                skip: processed,
                orderBy: { id: 'asc' }
            });

            const promises = orders.map(order => {
                // Ensure rawData is available and parseable
                // The prisma model stores rawData as Json.
                // We need to pass the raw order structure to indexOrder, 
                // OR construct it if indexOrder expects the specific shape.
                // indexOrder expects: { id, status, total, currency, date_created, billing, line_items, meta_data }

                // Usually order.rawData contains the full Woo Object.
                const raw: any = order.rawData;
                if (!raw) {
                    console.warn(`Order ${order.id} has no rawData, skipping.`);
                    return Promise.resolve();
                }

                // Patch raw data with local status/total if needed, but raw should be source of truth for items
                return IndexingService.indexOrder(order.accountId, raw);
            });

            await Promise.all(promises);
            processed += orders.length;
            console.log(`Indexed ${processed}/${count} orders...`);
        }

        console.log('Reindexing complete!');
        process.exit(0);

    } catch (error: any) {
        console.error('Reindex failed:', error);
        process.exit(1);
    }
}

reindexAll();
