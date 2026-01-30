/**
 * Recommendation Feedback Service
 * 
 * Retrieves and processes user feedback on recommendations to inform
 * future suggestion generation. Part of the AI learning loop.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';

export interface FeedbackContext {
    /** Products/topics to avoid suggesting */
    avoidList: string[];
    /** User's stated preferences and priorities */
    preferences: string[];
    /** Specific feedback from dismissed recommendations */
    dismissalPatterns: {
        category: string;
        reason: string;
        feedback: string | null;
        count: number;
    }[];
    /** IDs of all dismissed recommendations - never show these again */
    dismissedIds: Set<string>;
    /** Total feedback entries analyzed */
    totalFeedbackEntries: number;
}

/**
 * Retrieves aggregated feedback context for an account.
 * Used by analyzers to filter/adjust recommendations.
 */
export async function getFeedbackContext(accountId: string): Promise<FeedbackContext> {
    const context: FeedbackContext = {
        avoidList: [],
        preferences: [],
        dismissalPatterns: [],
        dismissedIds: new Set<string>(),
        totalFeedbackEntries: 0
    };

    try {
        // Get ALL dismissed recommendations (not just those with feedback)
        // This ensures we never show the same recommendation again
        const allDismissed = await prisma.recommendationLog.findMany({
            where: {
                accountId,
                status: 'dismissed'
            },
            orderBy: { dismissedAt: 'desc' },
            take: 200, // Keep track of last 200 dismissals
            select: {
                recommendationId: true,
                text: true,
                category: true,
                dismissReason: true,
                userFeedback: true,
                tags: true
            }
        });

        // Add all dismissed IDs to the set
        for (const entry of allDismissed) {
            if (entry.recommendationId) {
                context.dismissedIds.add(entry.recommendationId);
            }
        }

        // Filter to those with feedback for pattern analysis
        const recentFeedback = allDismissed.filter(
            e => e.userFeedback || e.dismissReason
        );

        context.totalFeedbackEntries = recentFeedback.length;

        // Aggregate dismissal patterns by category
        const patternMap = new Map<string, { reason: string; feedback: string | null; count: number }>();

        for (const entry of recentFeedback) {
            const key = `${entry.category}:${entry.dismissReason || 'unspecified'}`;
            const existing = patternMap.get(key);

            if (existing) {
                existing.count++;
                // Keep the most recent feedback
                if (entry.userFeedback && !existing.feedback) {
                    existing.feedback = entry.userFeedback;
                }
            } else {
                patternMap.set(key, {
                    reason: entry.dismissReason || 'unspecified',
                    feedback: entry.userFeedback,
                    count: 1
                });
            }

            // Extract specific keywords/products to avoid
            if (entry.userFeedback) {
                // Look for "don't suggest X" patterns
                const avoidMatches = entry.userFeedback.match(/(?:don't|do not|stop|avoid|ignore)\s+(?:suggest|recommend|show)(?:ing)?\s+(.+?)(?:\.|$)/gi);
                if (avoidMatches) {
                    for (const match of avoidMatches) {
                        const item = match.replace(/(?:don't|do not|stop|avoid|ignore)\s+(?:suggest|recommend|show)(?:ing)?\s+/i, '').trim();
                        if (item && item.length < 100) {
                            context.avoidList.push(item.toLowerCase());
                        }
                    }
                }

                // Look for preference patterns
                if (entry.userFeedback.includes('focus on') ||
                    entry.userFeedback.includes('prioritize') ||
                    entry.userFeedback.includes('prefer')) {
                    context.preferences.push(entry.userFeedback);
                }
            }
        }

        // Convert pattern map to array
        for (const [key, value] of patternMap.entries()) {
            const [category] = key.split(':');
            context.dismissalPatterns.push({
                category,
                reason: value.reason,
                feedback: value.feedback,
                count: value.count
            });
        }

        // Sort by count descending
        context.dismissalPatterns.sort((a, b) => b.count - a.count);

        Logger.debug('Loaded feedback context', {
            accountId,
            dismissedCount: context.dismissedIds.size,
            totalEntries: context.totalFeedbackEntries,
            avoidListSize: context.avoidList.length,
            preferencesCount: context.preferences.length,
            patternsCount: context.dismissalPatterns.length
        });

    } catch (error) {
        Logger.warn('Failed to load feedback context', { error, accountId });
    }

    return context;
}

/**
 * Check if a recommendation should be filtered based on past feedback.
 * Returns true if the recommendation should be skipped.
 */
export function shouldFilterRecommendation(
    recommendation: { id: string; headline: string; category: string; tags?: string[] },
    feedbackContext: FeedbackContext
): boolean {
    // FIRST: Check if this exact recommendation was previously dismissed
    // This is the primary filter - dismissed recommendations never reappear
    if (feedbackContext.dismissedIds.has(recommendation.id)) {
        return true;
    }

    const headlineLower = recommendation.headline.toLowerCase();

    // Check against avoid list (user said "don't suggest X")
    for (const avoidItem of feedbackContext.avoidList) {
        if (headlineLower.includes(avoidItem)) {
            return true;
        }
    }

    // Check if category has been repeatedly dismissed with "not_relevant"
    const categoryPattern = feedbackContext.dismissalPatterns.find(
        p => p.category === recommendation.category && p.reason === 'not_relevant' && p.count >= 3
    );
    if (categoryPattern) {
        return true;
    }

    return false;
}
