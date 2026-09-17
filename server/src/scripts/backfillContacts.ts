import 'dotenv/config';
import { prisma } from '../utils/prisma';
import { esClient } from '../utils/elastic';
import { backfillContactPage, ContactBackfillSource } from '../services/backfillContacts';
import { drainContactProjections, closeContactProjectionPool } from '../services/ContactProjection';

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        console.log('Usage: npm run contacts:backfill -- --account ID --source orders|enrollments|projections [--after UUID] [--batch-size 100] [--max-batches 100]');
        return;
    }
    const option = (key: string) => {
        const index = args.indexOf(key);
        return index < 0 ? undefined : args[index + 1];
    };
    const accountId = option('--account');
    const source = option('--source') as ContactBackfillSource | 'projections';
    const limit = Number(option('--batch-size') ?? 100);
    const maxBatches = Number(option('--max-batches') ?? 100);
    if (!accountId || !['orders', 'enrollments', 'projections'].includes(source) || !Number.isInteger(maxBatches) || maxBatches < 1) {
        throw new Error('Usage: backfillContacts --account ID --source orders|enrollments|projections [--after UUID] [--batch-size 100] [--max-batches 100]');
    }
    if (!await prisma.account.findUnique({ where: { id: accountId }, select: { id: true } })) throw new Error('Account not found');
    let after = option('--after');
    for (let batch = 0; batch < maxBatches; batch++) {
        if (source === 'projections') {
            const projected = await drainContactProjections(limit, accountId);
            console.log(JSON.stringify({ accountId, source, projected }));
            if (!projected) break;
            continue;
        }
        const page = await backfillContactPage(accountId, source, after, limit);
        after = page.cursor;
        console.log(JSON.stringify({ accountId, source, ...page }));
        if (page.done) break;
    }
    if (source === 'projections') await esClient.indices.refresh({ index: 'customers' });
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    await prisma.$disconnect();
    await closeContactProjectionPool();
    await esClient.close();
});
