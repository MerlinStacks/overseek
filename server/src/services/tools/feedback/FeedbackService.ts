import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { text } from '../toolData';

export interface FeedbackContext {
    avoidList: string[];
    preferences: string[];
    dismissalPatterns: { category: string; reason: string; feedback: string | null; count: number }[];
    /** All persisted dismissed recommendation IDs, not just recent feedback. */
    dismissedIds: Set<string>;
    totalFeedbackEntries: number;
    /** Failed lookups suppress recommendations rather than forgetting user dismissals. */
    available?: boolean;
}

export async function getFeedbackContext(accountId: string): Promise<FeedbackContext> {
    const context: FeedbackContext = { avoidList: [], preferences: [], dismissalPatterns: [], dismissedIds: new Set(), totalFeedbackEntries: 0, available: true };
    if (!text(accountId)) return { ...context, available: false };
    try {
        let cursor: string | undefined;
        while (true) {
            const rows = await prisma.recommendationLog.findMany({
                where: { accountId, status: 'dismissed' }, orderBy: { id: 'asc' }, take: 500,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                select: { id: true, recommendationId: true },
            });
            for (const row of rows) if (text(row.recommendationId)) context.dismissedIds.add(text(row.recommendationId));
            if (rows.length < 500) break;
            cursor = rows[rows.length - 1].id;
        }
        // Textual learning is intentionally bounded; permanent dismissals above are not.
        const recent = await prisma.recommendationLog.findMany({
            where: { accountId, status: 'dismissed' }, take: 200,
            orderBy: [{ dismissedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
            select: { category: true, dismissReason: true, userFeedback: true },
        });
        const patterns = new Map<string, FeedbackContext['dismissalPatterns'][number]>();
        const avoid = new Set<string>();
        const preferences = new Map<string, string>();
        for (const row of recent) {
            const feedback = text(row.userFeedback);
            const reason = text(row.dismissReason) || 'unspecified';
            if (!feedback && reason === 'unspecified') continue;
            context.totalFeedbackEntries++;
            const category = text(row.category);
            const key = JSON.stringify([category, reason]);
            const existing = patterns.get(key);
            if (existing) {
                existing.count++;
                if (!existing.feedback && feedback) existing.feedback = feedback;
            } else patterns.set(key, { category, reason, feedback: feedback || null, count: 1 });
            const matches = feedback.matchAll(/(?:don['’]t|do not|stop|avoid|ignore)\s+(?:suggest|recommend|show)(?:ing)?\s+([^.!?\n]+)/gi);
            for (const match of matches) {
                const value = match[1].trim().toLowerCase();
                if (value && value.length < 100) avoid.add(value);
            }
            if (/\b(?:focus\s+on|prioriti[sz]e|prefer(?:ences?)?)\b/i.test(feedback)) preferences.set(feedback.toLowerCase(), preferences.get(feedback.toLowerCase()) || feedback);
        }
        context.avoidList = [...avoid];
        context.preferences = [...preferences.values()];
        context.dismissalPatterns = [...patterns.values()].sort((a, b) => b.count - a.count);
        Logger.debug('Loaded feedback context', { accountId, dismissedCount: context.dismissedIds.size, totalEntries: context.totalFeedbackEntries });
    } catch (error) {
        context.available = false;
        Logger.warn('Failed to load feedback context', { error, accountId });
    }
    return context;
}

export function shouldFilterRecommendation(recommendation: { id: string; headline: string; category: string; tags?: string[] }, context: FeedbackContext): boolean {
    if (!context || context.available === false || !recommendation || !text(recommendation.id) || !text(recommendation.headline)) return true;
    if (context.dismissedIds.has(text(recommendation.id))) return true;
    const words = (value: string) => ` ${(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(' ')} `;
    const headline = words(recommendation.headline);
    if (context.avoidList.some(item => text(item) && words(item).trim() && headline.includes(words(item)))) return true;
    return context.dismissalPatterns.some(pattern => pattern.category === recommendation.category && pattern.reason === 'not_relevant' && pattern.count >= 3);
}
