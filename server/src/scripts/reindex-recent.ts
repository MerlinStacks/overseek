
import { prisma } from '../utils/prisma';
import { IndexingService } from '../services/search/IndexingService';
import { Logger } from '../utils/logger';

async function reindexRecent() {
    try {
        console.log('--- Re-indexing Recent Orders ---');

        // Find an active account
        const account = await prisma.account.findFirst();
        if (!account) {
            console.log('No account found');
            return;
        }

        const accountId = account.id;
        console.log(`Processing Account: ${accountId}`);

        // Fetch last 100 orders
        const orders = await prisma.wooOrder.findMany({
            where: { accountId },
            orderBy: { dateCreated: 'desc' },
            take: 100,
            select: { rawData: true }
        });

        console.log(`Found ${orders.length} orders to re-index.`);

        for (const o of orders) {
            const raw: any = o.rawData;
            // Force status normalization here too just in case, though OrderSync handles it for *new* orders.
            // Existing orders in DB might still have Title Case status in rawData.
            // But IndexingService now calls .toLowerCase() on status, so we are good.

            // We pass the raw data which has date_created and date_created_gmt
            await IndexingService.indexOrder(accountId, raw, []);
            process.stdout.write('.');
        }

        console.log('\nDone.');

    } catch (e) {
        console.error('Error:', e);
    }
}

reindexRecent().then(() => process.exit(0));
