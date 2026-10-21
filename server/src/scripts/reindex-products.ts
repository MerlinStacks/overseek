import type { PrismaClient } from '@prisma/client';
import { operationalOptions, safeDestination, usage, assertSearchConfirmation, closeOperationalResources, type OperationalOptions } from './operationalSafety';

interface Dependencies { db: PrismaClient; index: (accountId: string, product: unknown) => Promise<unknown> }
export async function reindexProducts(options: OperationalOptions, { db, index }: Dependencies) {
    const base = { ...(options.accountId ? { accountId: options.accountId } : {}), createdAt: { lte: options.before } };
    const top = await db.wooProduct.findFirst({ where: base, orderBy: { id: 'desc' }, select: { id: true } });
    const summary = { matched: 0, scanned: 0, indexed: 0, failed: 0, remaining: 0, dryRun: !options.apply };
    if (!top) return summary;
    summary.matched = await db.wooProduct.count({ where: { ...base, id: { lte: top.id } } });
    if (!options.apply) { summary.remaining = summary.matched; return summary; }
    let lastId: string | undefined;
    while (summary.scanned < options.limit) {
        const products = await db.wooProduct.findMany({ where: { ...base, id: { lte: top.id, ...(lastId ? { gt: lastId } : {}) } }, take: Math.min(options.batchSize, options.limit - summary.scanned), orderBy: { id: 'asc' }, include: { variations: true } });
        if (!products.length) break;
        for (const product of products) { summary.scanned++; try { await index(product.accountId, product); summary.indexed++; } catch { summary.failed++; } }
        const nextId = products[products.length - 1].id;
        if (lastId && nextId <= lastId) throw new Error('Product traversal did not advance');
        lastId = nextId;
    }
    summary.remaining = Math.max(0, summary.matched - summary.scanned);
    return summary;
}
export async function main(args = process.argv.slice(2)) {
    if (args.includes('--help')) { console.info(usage('reindex-products')); return; }
    (await import('dotenv')).config();
    const options = operationalOptions('reindex-products', args); assertSearchConfirmation('reindex-products', options);
    const { prisma: db } = await import('../utils/prisma'); let search: typeof import('../utils/elastic')['esClient'] | undefined;
    try {
        let index: Dependencies['index'] = async () => { throw new Error('Dry-run cannot index'); };
        if (options.apply) {
            search = (await import('../utils/elastic')).esClient; await search.ping();
            const { IndexingService } = await import('../services/search/IndexingService'); await IndexingService.initializeIndices();
            if (!await search.indices.exists({ index: 'products' })) throw new Error('Products index unavailable');
            index = (accountId, product) => IndexingService.indexProduct(accountId, product, false);
        }
        const summary = await reindexProducts(options, { db, index });
        if (options.apply) await search!.indices.refresh({ index: 'products' });
        console.info('Product reindex outcome (non-destructive)', { destination: safeDestination(process.env.DATABASE_URL), ...summary });
        if (options.apply && (summary.failed || summary.remaining)) process.exitCode = 2;
    } finally { await closeOperationalResources([() => db.$disconnect(), ...(search ? [() => search!.close()] : [])]); }
}
if (require.main === module) void main().catch(() => { console.error('Product reindex failed. Check scope, confirmations and service health.'); process.exitCode = 1; });
