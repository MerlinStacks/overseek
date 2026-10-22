import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../../utils/prisma';
import { PermissionService } from '../../PermissionService';
import type { ExplainableRecommendation } from './RecommendationEngine';

export type RecommendationStatus = 'pending' | 'implemented' | 'dismissed' | 'expired';
export type DismissReason = 'not_relevant' | 'already_done' | 'disagree' | 'will_do_later';
const id = z.string().trim().min(1).max(300), version = z.string().datetime();
export const feedbackSchema = z.object({ status: z.enum(['implemented', 'dismissed']), dismissReason: z.enum(['not_relevant', 'already_done', 'disagree', 'will_do_later']).optional(), notes: z.string().max(4000).optional(), version }).strict();
const windowSchema = z.object({ start: z.string().datetime(), end: z.string().datetime() }).strict().refine(w => Date.parse(w.start) < Date.parse(w.end));
export const outcomeSchema = z.object({ roasBefore: z.number().finite().min(0).max(1000000), roasAfter: z.number().finite().min(0).max(1000000), notes: z.string().max(4000).optional(), version,
    currency: z.string().regex(/^[A-Z]{3}$/), adAccountId: id, resourceId: id, before: windowSchema, after: windowSchema }).strict().refine(value => Date.parse(value.before.end) <= Date.parse(value.after.start) && Date.parse(value.before.end) - Date.parse(value.before.start) === Date.parse(value.after.end) - Date.parse(value.after.start), 'Use ordered nonoverlapping equal-duration windows');
export type RecommendationFeedback = z.infer<typeof feedbackSchema>;
export type OutcomeData = z.infer<typeof outcomeSchema>;
export interface RecommendationStats { totalGenerated: number; implemented: number; dismissed: number; pending: number; successRate: null; avgRoasImprovement: null; byCategory: Record<string, { count: number; implemented: number; successRate: null }>; topPerformingRules: never[]; coverage: { limit: number; truncated: boolean; method: string } }
const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const scope = (accountId: string) => id.parse(accountId);
async function authorize(userId: string, accountId: string) {
    id.parse(userId); scope(accountId);
    if (!await PermissionService.hasPermission(userId, accountId, 'manage_marketing')) throw fail('Marketing management permission required', 403);
}
export class RecommendationTracker {
    /** The caller supplies a stable generation occurrence; do not derive identity by splitting a rule ID. */
    static async logRecommendations(accountId: string, recommendations: (ExplainableRecommendation & { campaignId?: string; adAccountId?: string })[], occurrence: string): Promise<void> {
        scope(accountId); id.parse(occurrence);
        if (!Array.isArray(recommendations) || recommendations.length > 200) throw fail('Invalid recommendation batch', 400);
        const data = recommendations.map(rec => {
            id.parse(rec.id);
            const text = z.string().min(1).max(10000).parse(rec.text), category = z.string().min(1).max(80).parse(rec.category);
            const score = z.number().int().min(0).max(100).parse(rec.confidence?.score);
            return { id: crypto.createHash('sha256').update(JSON.stringify([accountId, occurrence, rec.id])).digest('hex'), accountId, recommendationId: rec.id, text, category,
                priority: z.number().int().min(1).max(3).parse(rec.priority), platform: rec.platform ? z.enum(['google', 'meta', 'both']).parse(rec.platform) : null, campaignName: rec.campaignName ? z.string().max(500).parse(rec.campaignName) : null,
                campaignId: rec.campaignId ? id.parse(rec.campaignId) : null, resourceAccountId: rec.adAccountId ? id.parse(rec.adAccountId) : null,
                confidenceScore: score, confidenceLevel: z.enum(['high', 'medium', 'low']).parse(rec.confidence?.level),
                dataPoints: z.array(z.string().max(1000)).max(30).parse(rec.dataPoints), tags: z.array(z.string().max(100)).max(30).parse(rec.tags || []) };
        });
        const resourceIds = [...new Set(data.flatMap(row => row.resourceAccountId ? [row.resourceAccountId] : []))];
        if (resourceIds.length) {
            const resources = await prisma.adAccount.findMany({ where: { accountId, id: { in: resourceIds } }, select: { id: true }, take: 201 });
            if (resources.length !== resourceIds.length) throw fail('Recommendation resource outside account', 400);
        }
        await prisma.recommendationLog.createMany({ data, skipDuplicates: true });
    }
    static async recordFeedback(accountId: string, userId: string, logId: string, input: RecommendationFeedback): Promise<boolean> {
        await authorize(userId, accountId); id.parse(logId); const feedback = feedbackSchema.parse(input);
        const now = new Date(Math.max(Date.now(), Date.parse(feedback.version) + 1));
        const result = await prisma.recommendationLog.updateMany({ where: { id: logId, accountId, status: 'pending', updatedAt: new Date(feedback.version) }, data: {
            status: feedback.status, updatedAt: now, ...(feedback.status === 'implemented' ? { implementedAt: now } : { dismissedAt: now, dismissReason: feedback.dismissReason }), userFeedback: feedback.notes,
        } });
        if (result.count !== 1) throw fail('Recommendation changed or unavailable', 409);
        return true;
    }
    static async recordOutcome(accountId: string, userId: string, logId: string, input: OutcomeData): Promise<boolean> {
        await authorize(userId, accountId); id.parse(logId); const outcome = outcomeSchema.parse(input);
        const row = await prisma.recommendationLog.findFirst({ where: { id: logId, accountId, status: 'implemented', outcomeRecordedAt: null }, select: { campaignId: true, resourceAccountId: true, implementedAt: true } });
        if (!row || !row.campaignId || row.campaignId !== outcome.resourceId || row.resourceAccountId !== outcome.adAccountId || !row.implementedAt || Date.parse(outcome.before.end) > row.implementedAt.getTime() || Date.parse(outcome.after.start) < row.implementedAt.getTime() || Date.parse(outcome.after.end) > Date.now()) throw fail('Comparable implemented-resource observation required', 409);
        if (!await prisma.adAccount.findFirst({ where: { id: outcome.adAccountId, accountId, currency: outcome.currency }, select: { id: true } })) throw fail('Resource account/currency unavailable', 409);
        const change = outcome.roasBefore > 0 ? (outcome.roasAfter - outcome.roasBefore) / outcome.roasBefore * 100 : null;
        const result = await prisma.recommendationLog.updateMany({ where: { id: logId, accountId, campaignId: outcome.resourceId, resourceAccountId: outcome.adAccountId, status: 'implemented', outcomeRecordedAt: null, updatedAt: new Date(outcome.version) }, data: {
            outcomeRecordedAt: new Date(), roasBefore: outcome.roasBefore, roasAfter: outcome.roasAfter, roasChange: change !== null && Number.isFinite(change) ? change : null, wasSuccessful: null,
            outcomeNotes: outcome.notes, outcomeObservation: { before: outcome.before, after: outcome.after, currency: outcome.currency, resourceId: outcome.resourceId, adAccountId: outcome.adAccountId, reporterUserId: userId, basis: 'user-reported-observation-not-causal-success' }, updatedAt: new Date(Math.max(Date.now(), Date.parse(outcome.version) + 1)),
        } });
        if (result.count !== 1) throw fail('Outcome already recorded or recommendation changed', 409);
        return true;
    }
    static async getHistory(accountId: string, options: { status?: RecommendationStatus; limit?: number; offset?: number } = {}) {
        scope(accountId); const parsed = z.object({ status: z.enum(['pending', 'implemented', 'dismissed', 'expired']).optional(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(10000).default(0) }).strict().parse(options);
        return prisma.recommendationLog.findMany({ where: { accountId, ...(parsed.status ? { status: parsed.status } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: parsed.limit, skip: parsed.offset });
    }
    static async getStats(accountId: string, days = 90): Promise<RecommendationStats> {
        scope(accountId); z.number().int().min(1).max(365).parse(days);
        const rows = await prisma.recommendationLog.findMany({ where: { accountId, createdAt: { gte: new Date(Date.now() - days * 86400000) } }, select: { status: true, category: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 10001 });
        const logs = rows.slice(0, 10000), categories = new Map<string, { count: number; implemented: number; successRate: null }>();
        for (const log of logs) { const bucket = categories.get(log.category) || { count: 0, implemented: 0, successRate: null }; bucket.count++; if (log.status === 'implemented') bucket.implemented++; categories.set(log.category, bucket); }
        return { totalGenerated: logs.length, implemented: logs.filter(row => row.status === 'implemented').length, dismissed: logs.filter(row => row.status === 'dismissed').length, pending: logs.filter(row => row.status === 'pending').length,
            successRate: null, avgRoasImprovement: null, byCategory: Object.fromEntries(categories), topPerformingRules: [], coverage: { limit: 10000, truncated: rows.length > 10000, method: 'observed-status-counts; no causal success or confidence learning' } };
    }
    static async getSuccessRateForRule(recommendationId: string, accountId?: string): Promise<null> { id.parse(recommendationId); scope(accountId); return null; }
}
