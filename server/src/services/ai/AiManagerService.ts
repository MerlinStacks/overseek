import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { PermissionService } from '../PermissionService';

/** Bounded local heuristics only. No provider generation or inferred performance forecasts. */
export class AiManagerService {
    static async generateSuggestions(accountId: string, userId: string, occurrence: string): Promise<{ created: number; basis: string }> {
        z.string().min(1).max(200).parse(accountId); z.string().min(1).max(200).parse(userId); z.string().uuid().parse(occurrence);
        if (!await PermissionService.hasPermission(userId, accountId, 'manage_marketing')) throw Object.assign(new Error('Permission required'), { statusCode: 403 });
        const identity = crypto.createHash('sha256').update(JSON.stringify(['ai-refresh', accountId, userId, occurrence])).digest('hex');
        return prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`ai-refresh:${accountId}`}, 0))`;
            const receipt = await tx.scopedOperation.findUnique({ where: { id: identity } });
            if (receipt) return z.object({ created: z.number().int().min(0).max(10), basis: z.string() }).parse(receipt.result);
            const recent = await tx.scopedOperation.findFirst({ where: { accountId, kind: 'ai-refresh', createdAt: { gt: new Date(Date.now() - 3600000) } }, select: { id: true } });
            if (recent) throw Object.assign(new Error('Refresh limited to one batch per hour per account'), { statusCode: 429 });
            const [products, pages, posts] = await Promise.all([
                tx.wooProduct.findMany({ where: { accountId, seoScore: { lt: 65 }, status: { not: 'trash' } }, select: { id: true, name: true, seoScore: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 4 }),
                tx.wooPage.findMany({ where: { accountId, seoScore: { lt: 65 } }, select: { id: true, title: true, seoScore: true }, orderBy: [{ dateModified: 'desc' }, { id: 'asc' }], take: 3 }),
                tx.wooBlogPost.findMany({ where: { accountId, seoScore: { lt: 65 } }, select: { id: true, title: true, seoScore: true }, orderBy: [{ dateModified: 'desc' }, { id: 'asc' }], take: 3 }),
            ]);
            const candidates = [...products.map(row => ({ ...row, title: row.name, type: 'PRODUCT_REWRITE' })), ...pages.map(row => ({ ...row, type: 'PAGE_REWRITE' })), ...posts.map(row => ({ ...row, type: 'BLOG_REWRITE' }))];
            const data = candidates.map(row => {
                const hash = crypto.createHash('sha256').update(JSON.stringify([accountId, row.type, row.id, row.seoScore, row.title])).digest('hex');
                return { id: hash, accountId, recommendationId: `ai_manager_${hash}`, campaignName: `Review content: ${row.title.slice(0, 450)}`, text: 'Review this local SEO score and inspect content quality before making changes. This heuristic does not predict ranking, revenue or savings.', category: row.type, platform: 'SEO_CONTENT', priority: 3, confidenceScore: 0, confidenceLevel: 'low', dataPoints: [`Local SEO score: ${row.seoScore}`, 'Local bounded sample; provider health and performance impact not verified'], tags: ['review-only', 'uncalibrated-local-heuristic'] };
            });
            const inserted = data.length ? await tx.recommendationLog.createMany({ data, skipDuplicates: true }) : { count: 0 };
            const result = { created: inserted.count, basis: 'bounded-local-content-heuristic; confidence unavailable' };
            await tx.scopedOperation.create({ data: { id: identity, accountId, kind: 'ai-refresh', result } });
            return result;
        }, { timeout: 15000 });
    }
}
