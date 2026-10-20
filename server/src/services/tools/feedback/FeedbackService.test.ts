import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../../utils/prisma', () => ({ prisma: { recommendationLog: { findMany: mocks.findMany } } }));
vi.mock('../../../utils/logger', () => ({ Logger: { warn: vi.fn(), debug: vi.fn() } }));
import { getFeedbackContext, shouldFilterRecommendation } from './FeedbackService';
const recommendation = { id: 'old-recommendation', headline: 'Advertise rings', category: 'budget' };
beforeEach(() => { vi.resetAllMocks(); mocks.findMany.mockResolvedValue([]); });
describe('recommendation feedback', () => {
    it('loads permanent dismissal IDs beyond the latest 200, using bounded cursor queries', async () => {
        const ids = Array.from({ length: 500 }, (_, i) => ({ id: `row-${i}`, recommendationId: `rec-${i}` }));
        mocks.findMany.mockResolvedValueOnce(ids).mockResolvedValueOnce([{ id: 'row-old', recommendationId: 'old-recommendation' }]).mockResolvedValueOnce([]);
        const context = await getFeedbackContext('tenant-1');
        expect(context.dismissedIds.size).toBe(501);
        expect(shouldFilterRecommendation(recommendation, context)).toBe(true);
        expect(mocks.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ take: 500, cursor: { id: 'row-499' }, skip: 1, where: { accountId: 'tenant-1', status: 'dismissed' } }));
        expect(mocks.findMany).toHaveBeenNthCalledWith(3, expect.objectContaining({ take: 200 }));
    });
    it('extracts case-insensitive, deduplicated preferences and avoid phrases', async () => {
        mocks.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
            { category: 'budget:meta', dismissReason: 'not_relevant', userFeedback: "Don't suggest rings. FOCUS ON revenue." },
            { category: 'budget:meta', dismissReason: 'not_relevant', userFeedback: "don't suggest rings. focus on revenue." },
            { category: 'budget:meta', dismissReason: 'not_relevant', userFeedback: 'Prioritise profit.' },
        ]);
        const context = await getFeedbackContext('tenant-1');
        expect(context.avoidList).toEqual(['rings']);
        expect(context.preferences).toHaveLength(2);
        expect(context.dismissalPatterns[0]).toEqual(expect.objectContaining({ category: 'budget:meta', count: 3 }));
    });
    it('does not apply avoid keywords to unrelated substrings', async () => {
        const context = await getFeedbackContext('tenant-1');
        context.avoidList = ['ring'];
        expect(shouldFilterRecommendation({ ...recommendation, headline: 'Spring campaign' }, context)).toBe(false);
        expect(shouldFilterRecommendation({ ...recommendation, headline: 'Advertise a ring' }, context)).toBe(true);
    });
    it('filters repeated category dismissals while leaving other categories eligible', async () => {
        const context = await getFeedbackContext('tenant-1');
        context.dismissalPatterns = [{ category: 'budget', reason: 'not_relevant', feedback: null, count: 3 }];
        expect(shouldFilterRecommendation(recommendation, context)).toBe(true);
        expect(shouldFilterRecommendation({ ...recommendation, category: 'creative' }, context)).toBe(false);
    });
    it('fails closed if dismissal lookup fails instead of forgetting dismissed IDs', async () => {
        mocks.findMany.mockRejectedValue(new Error('Database unavailable'));
        const context = await getFeedbackContext('tenant-1');
        expect(context.available).toBe(false);
        expect(shouldFilterRecommendation(recommendation, context)).toBe(true);
    });
    it('blocks missing account context and malformed recommendations safely', async () => {
        const unavailable = await getFeedbackContext('');
        expect(unavailable.available).toBe(false);
        expect(mocks.findMany).not.toHaveBeenCalled();
        const context = await getFeedbackContext('tenant-1');
        expect(shouldFilterRecommendation({ ...recommendation, headline: null } as any, context)).toBe(true);
        expect(shouldFilterRecommendation(null as any, context)).toBe(true);
    });
});
