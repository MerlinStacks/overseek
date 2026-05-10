import { BaseSync, SyncResult } from './BaseSync';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { WooPageSchema, WooPage } from './wooSchemas';

export class PageSync extends BaseSync {
    protected entityType = 'pages';

    protected async sync(woo: WooService, accountId: string, incremental: boolean, job?: any, syncId?: string): Promise<SyncResult> {
        const after = incremental ? await this.getLastSync(accountId) : undefined;
        const syncStartedAt = new Date();
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;
        let totalDeleted = 0;
        let totalSkipped = 0;

        while (hasMore) {
            const { data: rawPages, totalPages } = await woo.getPages({ page, after, per_page: 50 });
            if (!rawPages.length) {
                hasMore = false;
                break;
            }

            const pages: WooPage[] = [];
            for (const raw of rawPages) {
                const result = WooPageSchema.safeParse(raw);
                if (result.success) {
                    pages.push(result.data);
                } else {
                    totalSkipped++;
                    Logger.debug('Skipping invalid page', {
                        accountId, syncId, pageId: (raw as any)?.id,
                        errors: result.error.issues.map(i => i.message).slice(0, 3)
                    });
                }
            }

            if (!pages.length) {
                page++;
                continue;
            }

            const failedWooIds: number[] = [];
            await Promise.all(
                pages.map((p) =>
                    prisma.wooPage.upsert({
                        where: { accountId_wooId: { accountId, wooId: p.id } },
                        update: {
                            title: p.title?.rendered || '',
                            slug: p.slug,
                            status: p.status,
                            permalink: p.link || null,
                            content: p.content?.rendered || '',
                            excerpt: p.excerpt?.rendered || '',
                            dateCreated: new Date(p.date_gmt || p.date || new Date()),
                            dateModified: new Date(p.modified_gmt || p.modified || new Date()),
                            rawData: p as any
                        },
                        create: {
                            accountId,
                            wooId: p.id,
                            title: p.title?.rendered || '',
                            slug: p.slug,
                            status: p.status,
                            permalink: p.link || null,
                            content: p.content?.rendered || '',
                            excerpt: p.excerpt?.rendered || '',
                            dateCreated: new Date(p.date_gmt || p.date || new Date()),
                            dateModified: new Date(p.modified_gmt || p.modified || new Date()),
                            rawData: p as any
                        }
                    }).catch((err) => {
                        totalSkipped++;
                        failedWooIds.push(p.id);
                        Logger.warn('Failed to upsert page', { accountId, syncId, wooId: p.id, error: err.message });
                    })
                )
            );

            if (failedWooIds.length > 0) {
                await prisma.$executeRawUnsafe(
                    `UPDATE "WooPage" SET "updatedAt" = NOW() WHERE "accountId" = $1 AND "wooId" = ANY($2::int[])`,
                    accountId, failedWooIds
                );
            }

            totalProcessed += pages.length;
            if (page >= totalPages) hasMore = false;

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                if (!(await job.isActive())) throw new Error('Cancelled');
            }

            page++;
            if (hasMore) await new Promise(r => setTimeout(r, 500));
        }

        if (!incremental && totalProcessed > 0) {
            const staleCount = await prisma.wooPage.count({ where: { accountId, updatedAt: { lt: syncStartedAt } } });
            if (staleCount > 0) {
                const localTotal = await prisma.wooPage.count({ where: { accountId } });
                const maxDeletions = Math.max(10, Math.floor(localTotal * 0.3));
                if (staleCount > maxDeletions) {
                    Logger.warn(`Page reconciliation aborted: would delete ${staleCount}/${localTotal} (>30% cap)`, {
                        accountId, syncId, toDelete: staleCount, localTotal
                    });
                } else {
                    const { count } = await prisma.wooPage.deleteMany({ where: { accountId, updatedAt: { lt: syncStartedAt } } });
                    totalDeleted = count;
                }
            }
        }

        if (totalSkipped > 0) Logger.debug('Page sync skipped invalid records', { accountId, syncId, totalSkipped });
        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }
}
