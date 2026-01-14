/**
 * Recommendation Tracker
 * 
 * Tracks AI Marketing Co-Pilot recommendations, user interactions,
 * and outcomes for continuous learning.
 * 
 * Part of AI Marketing Co-Pilot Phase 5.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';
import { ExplainableRecommendation } from './RecommendationEngine';

// =============================================================================
// TYPES
// =============================================================================

export type RecommendationStatus = 'pending' | 'implemented' | 'dismissed' | 'expired';

export type DismissReason = 'not_relevant' | 'already_done' | 'disagree' | 'will_do_later';

export interface RecommendationFeedback {
    status: 'implemented' | 'dismissed';
    dismissReason?: DismissReason;
    notes?: string;
}

export interface OutcomeData {
    roasBefore: number;
    roasAfter: number;
    notes?: string;
}

export interface RecommendationStats {
    totalGenerated: number;
    implemented: number;
    dismissed: number;
    pending: number;

    successRate: number;           // % of implemented that improved ROAS
    avgRoasImprovement: number;    // Average ROAS change for successful

    byCategory: Record<string, {
        count: number;
        implemented: number;
        successRate: number;
    }>;

    topPerformingRules: {
        recommendationId: string;
        count: number;
        successRate: number;
    }[];
}

// =============================================================================
// MAIN SERVICE
// =============================================================================

export class RecommendationTracker {

    /**
     * Log a batch of recommendations that were generated.
     */
    static async logRecommendations(
        accountId: string,
        recommendations: ExplainableRecommendation[]
    ): Promise<void> {
        try {
            // Expire old pending recommendations first
            await this.expireOldRecommendations(accountId);

            // Insert new recommendations
            const data = recommendations.map(rec => ({
                accountId,
                recommendationId: rec.id.split('_')[0], // Base ID without campaign suffix
                text: rec.text,
                category: rec.category,
                priority: rec.priority,
                platform: rec.platform || null,
                campaignName: rec.campaignName || null,
                confidenceScore: rec.confidence.score,
                confidenceLevel: rec.confidence.level,
                dataPoints: rec.dataPoints,
                tags: rec.tags
            }));

            await prisma.recommendationLog.createMany({
                data,
                skipDuplicates: true
            });

            Logger.info('Logged recommendations', { accountId, count: recommendations.length });
        } catch (error) {
            Logger.error('Failed to log recommendations', { error, accountId });
        }
    }

    /**
     * Record user feedback on a recommendation.
     */
    static async recordFeedback(
        logId: string,
        feedback: RecommendationFeedback
    ): Promise<boolean> {
        try {
            const updateData: any = {
                status: feedback.status,
                updatedAt: new Date()
            };

            if (feedback.status === 'implemented') {
                updateData.implementedAt = new Date();
            } else if (feedback.status === 'dismissed') {
                updateData.dismissedAt = new Date();
                updateData.dismissReason = feedback.dismissReason;
            }

            await prisma.recommendationLog.update({
                where: { id: logId },
                data: updateData
            });

            Logger.info('Recorded recommendation feedback', { logId, status: feedback.status });
            return true;
        } catch (error) {
            Logger.error('Failed to record feedback', { error, logId });
            return false;
        }
    }

    /**
     * Record the outcome of an implemented recommendation.
     */
    static async recordOutcome(
        logId: string,
        outcome: OutcomeData
    ): Promise<boolean> {
        try {
            const roasChange = outcome.roasBefore > 0
                ? ((outcome.roasAfter - outcome.roasBefore) / outcome.roasBefore) * 100
                : 0;

            const wasSuccessful = roasChange > 0;

            await prisma.recommendationLog.update({
                where: { id: logId },
                data: {
                    outcomeRecordedAt: new Date(),
                    roasBefore: outcome.roasBefore,
                    roasAfter: outcome.roasAfter,
                    roasChange,
                    wasSuccessful,
                    outcomeNotes: outcome.notes
                }
            });

            Logger.info('Recorded recommendation outcome', {
                logId,
                roasChange: `${roasChange.toFixed(1)}%`,
                wasSuccessful
            });
            return true;
        } catch (error) {
            Logger.error('Failed to record outcome', { error, logId });
            return false;
        }
    }

    /**
     * Get recommendation history for an account.
     */
    static async getHistory(
        accountId: string,
        options?: {
            status?: RecommendationStatus;
            limit?: number;
            offset?: number;
        }
    ): Promise<any[]> {
        try {
            const where: any = { accountId };
            if (options?.status) {
                where.status = options.status;
            }

            return await prisma.recommendationLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: options?.limit || 50,
                skip: options?.offset || 0
            });
        } catch (error) {
            Logger.error('Failed to get recommendation history', { error, accountId });
            return [];
        }
    }

    /**
     * Calculate statistics for recommendations.
     */
    static async getStats(accountId: string, days: number = 90): Promise<RecommendationStats> {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const stats: RecommendationStats = {
            totalGenerated: 0,
            implemented: 0,
            dismissed: 0,
            pending: 0,
            successRate: 0,
            avgRoasImprovement: 0,
            byCategory: {},
            topPerformingRules: []
        };

        try {
            const logs = await prisma.recommendationLog.findMany({
                where: {
                    accountId,
                    createdAt: { gte: startDate }
                }
            });

            stats.totalGenerated = logs.length;

            // Count by status
            for (const log of logs) {
                if (log.status === 'implemented') stats.implemented++;
                else if (log.status === 'dismissed') stats.dismissed++;
                else if (log.status === 'pending') stats.pending++;

                // By category
                if (!stats.byCategory[log.category]) {
                    stats.byCategory[log.category] = { count: 0, implemented: 0, successRate: 0 };
                }
                stats.byCategory[log.category].count++;
                if (log.status === 'implemented') {
                    stats.byCategory[log.category].implemented++;
                }
            }

            // Calculate success rates
            const implementedWithOutcome = logs.filter(l =>
                l.status === 'implemented' && l.wasSuccessful !== null
            );

            if (implementedWithOutcome.length > 0) {
                const successful = implementedWithOutcome.filter(l => l.wasSuccessful);
                stats.successRate = Math.round((successful.length / implementedWithOutcome.length) * 100);

                const improvements = successful
                    .filter(l => l.roasChange !== null)
                    .map(l => l.roasChange!);

                if (improvements.length > 0) {
                    stats.avgRoasImprovement = Math.round(
                        improvements.reduce((a, b) => a + b, 0) / improvements.length * 10
                    ) / 10;
                }
            }

            // Calculate category success rates
            for (const category of Object.keys(stats.byCategory)) {
                const categoryLogs = logs.filter(l =>
                    l.category === category &&
                    l.status === 'implemented' &&
                    l.wasSuccessful !== null
                );
                if (categoryLogs.length > 0) {
                    const successful = categoryLogs.filter(l => l.wasSuccessful);
                    stats.byCategory[category].successRate = Math.round(
                        (successful.length / categoryLogs.length) * 100
                    );
                }
            }

            // Top performing rules
            const ruleStats = new Map<string, { count: number; successful: number }>();
            for (const log of implementedWithOutcome) {
                const existing = ruleStats.get(log.recommendationId) || { count: 0, successful: 0 };
                existing.count++;
                if (log.wasSuccessful) existing.successful++;
                ruleStats.set(log.recommendationId, existing);
            }

            stats.topPerformingRules = Array.from(ruleStats.entries())
                .map(([id, data]) => ({
                    recommendationId: id,
                    count: data.count,
                    successRate: Math.round((data.successful / data.count) * 100)
                }))
                .filter(r => r.count >= 3) // Minimum sample size
                .sort((a, b) => b.successRate - a.successRate)
                .slice(0, 5);

        } catch (error) {
            Logger.error('Failed to calculate recommendation stats', { error, accountId });
        }

        return stats;
    }

    /**
     * Get success rate for a specific recommendation type.
     * Used to adjust confidence in future recommendations.
     */
    static async getSuccessRateForRule(
        recommendationId: string,
        accountId?: string
    ): Promise<number | null> {
        try {
            const where: any = {
                recommendationId,
                status: 'implemented',
                wasSuccessful: { not: null }
            };
            if (accountId) {
                where.accountId = accountId;
            }

            const logs = await prisma.recommendationLog.findMany({ where });

            if (logs.length < 3) return null; // Not enough data

            const successful = logs.filter(l => l.wasSuccessful);
            return successful.length / logs.length;
        } catch (error) {
            Logger.error('Failed to get success rate', { error, recommendationId });
            return null;
        }
    }

    /**
     * Expire old pending recommendations.
     */
    private static async expireOldRecommendations(accountId: string): Promise<void> {
        const expiryDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days

        await prisma.recommendationLog.updateMany({
            where: {
                accountId,
                status: 'pending',
                createdAt: { lt: expiryDate }
            },
            data: { status: 'expired' }
        });
    }
}
