import type { PrismaClient } from '@prisma/client';
import { operationalOptions, safeDestination, usage, assertSearchConfirmation, closeOperationalResources, type OperationalOptions } from './operationalSafety';

interface Dependencies { db: PrismaClient; index: (accountId: string, order: Record<string, unknown>, tags: string[]) => Promise<unknown>; tags: (accountId: string, order: Record<string, unknown>) => Promise<string[]> }
export async function reindexOrders(options: OperationalOptions, { db, index, tags }: Dependencies) {
    const base = { ...(options.accountId ? { accountId: options.accountId } : {}), createdAt: { lte: options.before } };
    const top = await db.wooOrder.findFirst({ where: base, orderBy: { id: 'desc' }, select: { id: true } });
    const summary = { matched: 0, scanned: 0, indexed: 0, skipped: 0, failed: 0, remaining: 0, dryRun: !options.apply };
    if (!top) return summary;
    const bounded = { ...base, id: { lte: top.id } };
    summary.matched = await db.wooOrder.count({ where: bounded });
    if (!options.apply) { summary.remaining = summary.matched; return summary; }
    let lastId: string | undefined;
    while (summary.scanned < options.limit) {
        const rows = await db.wooOrder.findMany({ where: { ...base, id: { lte: top.id, ...(lastId ? { gt: lastId } : {}) } }, take: Math.min(options.batchSize, options.limit - summary.scanned), orderBy: { id: 'asc' } });
        if (!rows.length) break;
        for (const row of rows) {
            summary.scanned++;
            if (!row.rawData || typeof row.rawData !== 'object' || Array.isArray(row.rawData)) { summary.skipped++; continue; }
            const raw = row.rawData as Record<string, unknown>;
            if (!Array.isArray(raw.line_items) || !raw.billing || typeof raw.billing !== 'object' || Array.isArray(raw.billing)) { summary.skipped++; continue; }
            const billing = { ...raw.billing as Record<string, unknown>, ...(row.billingEmail ? { email: row.billingEmail } : {}), ...(row.billingCountry ? { country: row.billingCountry } : {}) };
            const order = { ...raw, id: row.wooId, status: row.status, total: row.total.toString(), currency: row.currency, date_created_gmt: row.dateCreated.toISOString(), billing, ...(row.wooCustomerId != null ? { customer_id: row.wooCustomerId } : {}) };
            try { await index(row.accountId, order, await tags(row.accountId, order)); summary.indexed++; } catch { summary.failed++; }
        }
        const nextId = rows[rows.length - 1].id;
        if (lastId && nextId <= lastId) throw new Error('Order traversal did not advance');
        lastId = nextId;
    }
    summary.remaining = Math.max(0, summary.matched - summary.scanned);
    return summary;
}
export async function main(args = process.argv.slice(2)) {
    if (args.includes('--help')) { console.info(usage('reindex-orders')); return; }
    (await import('dotenv')).config();
    const options = operationalOptions('reindex-orders', args); assertSearchConfirmation('reindex-orders', options);
    const { prisma: db } = await import('../utils/prisma');
    let search: typeof import('../utils/elastic')['esClient'] | undefined;
    try {
        let index: Dependencies['index'] = async () => { throw new Error('Dry-run cannot index'); };
        let tags: Dependencies['tags'] = async () => [];
        if (options.apply) {
            search = (await import('../utils/elastic')).esClient;
            await search.ping();
            const { IndexingService } = await import('../services/search/IndexingService');
            await IndexingService.initializeIndices();
            if (!await search.indices.exists({ index: 'orders' })) throw new Error('Orders index unavailable');
            index = (accountId, order, orderTags) => IndexingService.indexOrder(accountId, order, orderTags, false);
            const { OrderTaggingService } = await import('../services/OrderTaggingService'); tags = (accountId, order) => OrderTaggingService.extractTagsFromOrder(accountId, order);
        }
        const summary = await reindexOrders(options, { db, index, tags });
        if (options.apply) await search!.indices.refresh({ index: 'orders' });
        console.info('Order reindex outcome (non-destructive)', { destination: safeDestination(process.env.DATABASE_URL), ...summary });
        if (options.apply && (summary.failed || summary.skipped || summary.remaining)) process.exitCode = 2;
    } finally { await closeOperationalResources([() => db.$disconnect(), ...(search ? [() => search!.close()] : [])]); }
}
if (require.main === module) void main().catch(() => { console.error('Order reindex failed. Check scope, confirmations and service health. No shared index was deleted.'); process.exitCode = 1; });
