/**
 * Learning Service
 * 
 * Manages account-specific marketing learnings that extend the static knowledge base.
 * Supports user-created rules and AI-derived suggestions (requiring approval).
 * 
 * Part of AI Marketing Co-Pilot Phase 4.
 */

import { prisma } from '../../../utils/prisma';
import { Logger } from '../../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

export type LearningPlatform = 'google' | 'meta' | 'both';
export type LearningCategory = 'bid_strategy' | 'audience' | 'creative' | 'budget' | 'structure' | 'optimization';
export type LearningSource = 'user' | 'ai_derived';

export interface CreateLearningInput {
    platform: LearningPlatform;
    category: LearningCategory;
    condition: string;
    recommendation: string;
    explanation?: string;
    source?: LearningSource;
    isPending?: boolean;
    derivedFromRecommendationIds?: string[];
}

export interface UpdateLearningInput {
    condition?: string;
    recommendation?: string;
    explanation?: string;
    isActive?: boolean;
    isPending?: boolean;
}

export interface LearningWithStats {
    id: string;
    platform: string;
    category: string;
    condition: string;
    recommendation: string;
    explanation: string | null;
    source: string;
    isActive: boolean;
    isPending: boolean;
    appliedCount: number;
    successCount: number;
    successRate: number;
    createdAt: Date;
}

// =============================================================================
// MAIN SERVICE
// =============================================================================

export class LearningService {
    /**
     * Create a new learning rule.
     */
    static async create(
        accountId: string,
        input: CreateLearningInput
    ): Promise<LearningWithStats> {
        const learning = await prisma.marketingLearning.create({
            data: {
                accountId,
                platform: input.platform,
                category: input.category,
                condition: input.condition,
                recommendation: input.recommendation,
                explanation: input.explanation,
                source: input.source || 'user',
                isPending: input.isPending || false,
                derivedFromRecommendationIds: input.derivedFromRecommendationIds
                    ? JSON.stringify(input.derivedFromRecommendationIds)
                    : undefined
            }
        });

        Logger.info('Created marketing learning', {
            learningId: learning.id,
            accountId,
            source: input.source
        });

        return this.toLearningWithStats(learning);
    }

    /**
     * Update an existing learning rule.
     */
    static async update(
        id: string,
        accountId: string,
        input: UpdateLearningInput
    ): Promise<LearningWithStats | null> {
        const existing = await prisma.marketingLearning.findFirst({
            where: { id, accountId }
        });

        if (!existing) return null;

        const updated = await prisma.marketingLearning.update({
            where: { id },
            data: {
                condition: input.condition,
                recommendation: input.recommendation,
                explanation: input.explanation,
                isActive: input.isActive,
                isPending: input.isPending
            }
        });

        return this.toLearningWithStats(updated);
    }

    /**
     * Delete a learning rule.
     */
    static async delete(id: string, accountId: string): Promise<boolean> {
        const existing = await prisma.marketingLearning.findFirst({
            where: { id, accountId }
        });

        if (!existing) return false;

        await prisma.marketingLearning.delete({ where: { id } });
        Logger.info('Deleted marketing learning', { learningId: id, accountId });
        return true;
    }

    /**
     * Get all learnings for an account.
     */
    static async list(
        accountId: string,
        options?: {
            includeInactive?: boolean;
            includePending?: boolean;
            platform?: LearningPlatform;
            category?: LearningCategory;
        }
    ): Promise<LearningWithStats[]> {
        const where: any = { accountId };

        if (!options?.includeInactive) {
            where.isActive = true;
        }
        if (!options?.includePending) {
            where.isPending = false;
        }
        if (options?.platform) {
            where.platform = { in: [options.platform, 'both'] };
        }
        if (options?.category) {
            where.category = options.category;
        }

        const learnings = await prisma.marketingLearning.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        return learnings.map(l => this.toLearningWithStats(l));
    }

    /**
     * Get a single learning by ID.
     */
    static async getById(id: string, accountId: string): Promise<LearningWithStats | null> {
        const learning = await prisma.marketingLearning.findFirst({
            where: { id, accountId }
        });

        return learning ? this.toLearningWithStats(learning) : null;
    }

    /**
     * Approve a pending AI-derived learning.
     */
    static async approvePending(id: string, accountId: string): Promise<boolean> {
        const existing = await prisma.marketingLearning.findFirst({
            where: { id, accountId, isPending: true }
        });

        if (!existing) return false;

        await prisma.marketingLearning.update({
            where: { id },
            data: { isPending: false }
        });

        Logger.info('Approved marketing learning', { learningId: id, accountId });
        return true;
    }

    /**
     * Get pending AI-derived learnings awaiting approval.
     */
    static async getPending(accountId: string): Promise<LearningWithStats[]> {
        const learnings = await prisma.marketingLearning.findMany({
            where: { accountId, isPending: true, source: 'ai_derived' },
            orderBy: { createdAt: 'desc' }
        });

        return learnings.map(l => this.toLearningWithStats(l));
    }

    /**
     * Increment the applied count for a learning.
     * Called when a learning rule matches and generates a recommendation.
     */
    static async recordApplication(id: string): Promise<void> {
        await prisma.marketingLearning.update({
            where: { id },
            data: { appliedCount: { increment: 1 } }
        });
    }

    /**
     * Record a successful outcome for a learning.
     * Called when an implemented recommendation leads to improved metrics.
     */
    static async recordSuccess(id: string): Promise<void> {
        await prisma.marketingLearning.update({
            where: { id },
            data: { successCount: { increment: 1 } }
        });
    }

    /**
     * Analyze recommendation outcomes and suggest new learnings.
     * Creates pending AI-derived rules from patterns in successful recommendations.
     */
    static async deriveFromOutcomes(accountId: string): Promise<LearningWithStats[]> {
        // Find recommendation patterns with 3+ successful implementations
        const successfulPatterns = await prisma.recommendationLog.groupBy({
            by: ['recommendationId', 'category', 'platform'],
            where: {
                accountId,
                wasSuccessful: true,
                status: 'implemented'
            },
            _count: { id: true },
            having: {
                id: { _count: { gte: 3 } }
            }
        });

        const derivedLearnings: LearningWithStats[] = [];

        for (const pattern of successfulPatterns) {
            // Check if we already have a learning for this pattern
            const existing = await prisma.marketingLearning.findFirst({
                where: {
                    accountId,
                    category: pattern.category,
                    platform: pattern.platform || 'both',
                    source: 'ai_derived'
                }
            });

            if (existing) continue;

            // Get sample recommendations to build the learning
            const samples = await prisma.recommendationLog.findMany({
                where: {
                    accountId,
                    recommendationId: pattern.recommendationId,
                    wasSuccessful: true
                },
                take: 5,
                orderBy: { roasChange: 'desc' }
            });

            if (samples.length === 0) continue;

            // Create a suggested learning based on the pattern
            const learning = await this.create(accountId, {
                platform: (pattern.platform as LearningPlatform) || 'both',
                category: pattern.category as LearningCategory,
                condition: `Pattern detected: ${pattern.recommendationId} has been successful ${pattern._count.id} times`,
                recommendation: samples[0].text,
                explanation: `AI-derived from ${pattern._count.id} successful implementations. Average ROAS improvement: ${this.calculateAverageRoasChange(samples)}%`,
                source: 'ai_derived',
                isPending: true,
                derivedFromRecommendationIds: samples.map(s => s.id)
            });

            derivedLearnings.push(learning);
        }

        if (derivedLearnings.length > 0) {
            Logger.info('Derived new marketing learnings', {
                accountId,
                count: derivedLearnings.length
            });
        }

        return derivedLearnings;
    }

    // =============================================================================
    // HELPERS
    // =============================================================================

    private static toLearningWithStats(learning: any): LearningWithStats {
        const successRate = learning.appliedCount > 0
            ? Math.round((learning.successCount / learning.appliedCount) * 100)
            : 0;

        return {
            id: learning.id,
            platform: learning.platform,
            category: learning.category,
            condition: learning.condition,
            recommendation: learning.recommendation,
            explanation: learning.explanation,
            source: learning.source,
            isActive: learning.isActive,
            isPending: learning.isPending,
            appliedCount: learning.appliedCount,
            successCount: learning.successCount,
            successRate,
            createdAt: learning.createdAt
        };
    }

    private static calculateAverageRoasChange(samples: any[]): string {
        const changes = samples.filter(s => s.roasChange != null).map(s => s.roasChange);
        if (changes.length === 0) return 'N/A';
        const avg = changes.reduce((sum, c) => sum + c, 0) / changes.length;
        return avg.toFixed(1);
    }
}
