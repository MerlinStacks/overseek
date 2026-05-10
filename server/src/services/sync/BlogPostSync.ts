import { BaseSync, SyncResult } from './BaseSync';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { WooPostSchema, WooPost } from './wooSchemas';

export class BlogPostSync extends BaseSync {
    protected entityType = 'blog-posts';

    protected async sync(woo: WooService, accountId: string, incremental: boolean, job?: any, syncId?: string): Promise<SyncResult> {
        const after = incremental ? await this.getLastSync(accountId) : undefined;
        const syncStartedAt = new Date();
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;
        let totalDeleted = 0;
        let totalSkipped = 0;

        while (hasMore) {
            const { data: rawPosts, totalPages } = await woo.getPosts({ page, after, per_page: 50 });
            if (!rawPosts.length) {
                hasMore = false;
                break;
            }

            const posts: WooPost[] = [];
            for (const raw of rawPosts) {
                const result = WooPostSchema.safeParse(raw);
                if (result.success) {
                    posts.push(result.data);
                } else {
                    totalSkipped++;
                    Logger.debug('Skipping invalid post', {
                        accountId, syncId, postId: (raw as any)?.id,
                        errors: result.error.issues.map(i => i.message).slice(0, 3)
                    });
                }
            }

            if (!posts.length) {
                page++;
                continue;
            }

            const failedWooIds: number[] = [];
            await Promise.all(
                posts.map((p) =>
                    prisma.wooBlogPost.upsert({
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
                        Logger.warn('Failed to upsert post', { accountId, syncId, wooId: p.id, error: err.message });
                    })
                )
            );

            if (failedWooIds.length > 0) {
                await prisma.$executeRawUnsafe(
                    `UPDATE "WooBlogPost" SET "updatedAt" = NOW() WHERE "accountId" = $1 AND "wooId" = ANY($2::int[])`,
                    accountId, failedWooIds
                );
            }

            totalProcessed += posts.length;
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
            const staleCount = await prisma.wooBlogPost.count({ where: { accountId, updatedAt: { lt: syncStartedAt } } });
            if (staleCount > 0) {
                const localTotal = await prisma.wooBlogPost.count({ where: { accountId } });
                const maxDeletions = Math.max(10, Math.floor(localTotal * 0.3));
                if (staleCount > maxDeletions) {
                    Logger.warn(`Blog post reconciliation aborted: would delete ${staleCount}/${localTotal} (>30% cap)`, {
                        accountId, syncId, toDelete: staleCount, localTotal
                    });
                } else {
                    const { count } = await prisma.wooBlogPost.deleteMany({ where: { accountId, updatedAt: { lt: syncStartedAt } } });
                    totalDeleted = count;
                }
            }
        }

        if (totalSkipped > 0) Logger.debug('Blog post sync skipped invalid records', { accountId, syncId, totalSkipped });
        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }
}
