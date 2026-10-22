import { prisma } from '../utils/prisma';
import { z } from 'zod';
export class EmailDashboardService {
    static async get(accountId: string, days: number) {
        z.string().trim().min(1).max(200).parse(accountId); z.number().int().min(1).max(365).parse(days);
        const end = new Date(), start = new Date(end); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - days + 1);
        const where = { accountId, createdAt: { gte: start, lt: end } };
        const [campaigns, statuses, totalUnsubscribes, recentUnsubscribes, logs, unsubscribes] = await Promise.all([
            prisma.campaignEvent.groupBy({ by: ['campaignType', 'eventType'], where: { ...where, campaignType: { in: ['automation', 'broadcast'] }, eventType: 'send' }, _count: true }),
            prisma.emailLog.groupBy({ by: ['status'], where, _count: true }), prisma.emailUnsubscribe.count({ where }),
            prisma.emailUnsubscribe.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 10, select: { id: true, email: true, scope: true, reason: true, createdAt: true } }),
            prisma.emailLog.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 10001, select: { status: true, createdAt: true } }),
            prisma.emailUnsubscribe.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 10001, select: { createdAt: true } }),
        ]);
        const terminal = new Set(['SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'FAILED', 'BOUNCED', 'COMPLAINED']);
        const count = (value: unknown) => z.number().int().nonnegative().safe().parse(value);
        const attemptedCount = statuses.filter(row => terminal.has(row.status)).reduce((sum, row) => sum + count(row._count), 0);
        const failedCount = statuses.filter(row => row.status === 'FAILED').reduce((sum, row) => sum + count(row._count), 0);
        const sends = (type: string) => campaigns.filter(row => row.campaignType === type && row.eventType === 'send').reduce((sum, row) => sum + count(row._count), 0);
        const trendComplete = logs.length <= 10000 && unsubscribes.length <= 10000;
        const buckets = new Map<string, { date: string; unsubscribes: number; failed: number; attempts: number }>();
        for (let i = 0; i < days; i++) { const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10); buckets.set(date, { date, unsubscribes: 0, failed: 0, attempts: 0 }); }
        if (trendComplete) {
            for (const log of logs) { const bucket = buckets.get(log.createdAt.toISOString().slice(0, 10)); if (!bucket) throw new Error('Unexpected log window'); if (terminal.has(log.status)) bucket.attempts++; if (log.status === 'FAILED') bucket.failed++; }
            for (const unsubscribe of unsubscribes) { const bucket = buckets.get(unsubscribe.createdAt.toISOString().slice(0, 10)); if (!bucket) throw new Error('Unexpected unsubscribe window'); bucket.unsubscribes++; }
        }
        return { days, rangeStart: start.toISOString(), rangeEnd: end.toISOString(), timezone: 'UTC', currency: null,
            kpis: { flowRevenue: null, broadcastRevenue: null, flowSends: sends('automation'), broadcastSends: sends('broadcast'), totalUnsubscribes: count(totalUnsubscribes), attemptedCount, failedCount, failureRate: attemptedCount > 0 ? failedCount / attemptedCount * 100 : null, bounceRate: null },
            trends: trendComplete ? [...buckets.values()].map(bucket => ({ date: bucket.date, unsubscribes: bucket.unsubscribes, failureRate: bucket.attempts > 0 ? bucket.failed / bucket.attempts * 100 : null })) : [], recentUnsubscribes,
            coverage: { trendComplete, trendRowLimit: 10000, currentDayPartial: true, revenue: 'unavailable: legacy event money lacks persisted currency and verified attribution/deduplication',
                failureDefinition: 'FAILED message-log rows / rows in SENT, DELIVERED, OPENED, CLICKED, FAILED, BOUNCED or COMPLAINED current statuses; not a provider bounce rate', unsubscribeDefinition: 'new unsubscribe records created within the UTC window', unknownStatusRows: statuses.filter(row => !terminal.has(row.status)).reduce((sum, row) => sum + count(row._count), 0) } };
    }
}
