/**
 * Creative Variant Service
 * 
 * Manages A/B testing experiments for ad creatives.
 * Tracks performance metrics, calculates statistical significance,
 * and auto-pauses underperforming variants.
 * Part of AI Co-Pilot v2 - Phase 4: Creative A/B Engine.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';

/** Parameters for creating a new experiment */
export interface CreateExperimentParams {
    name: string;
    platform: 'google' | 'meta';
    adAccountId: string;
    campaignId?: string;
    adGroupId?: string;
    primaryMetric?: 'ctr' | 'conversions' | 'roas';
    minSampleSize?: number;
    confidenceLevel?: number;
}

/** Variant content for creation */
export interface VariantContent {
    headlines?: string[];
    descriptions?: string[];
    primaryTexts?: string[];
    isControl?: boolean;
}

/** Result of significance analysis */
export interface SignificanceResult {
    experimentId: string;
    hasWinner: boolean;
    winnerId?: string;
    controlId: string;
    variants: {
        id: string;
        label: string;
        isControl: boolean;
        impressions: number;
        metricValue: number;
        pValue: number | null;
        isSignificant: boolean;
        status: string;
    }[];
    recommendation: string;
}

/**
 * Service for managing creative A/B experiments.
 */
export class CreativeVariantService {
    /**
     * Create a new A/B experiment.
     */
    static async createExperiment(
        accountId: string,
        params: CreateExperimentParams
    ): Promise<any> {
        const experiment = await prisma.creativeExperiment.create({
            data: {
                accountId,
                name: params.name,
                platform: params.platform,
                adAccountId: params.adAccountId,
                campaignId: params.campaignId,
                adGroupId: params.adGroupId,
                primaryMetric: params.primaryMetric || 'ctr',
                minSampleSize: params.minSampleSize || 100,
                confidenceLevel: params.confidenceLevel || 0.95
            }
        });

        Logger.info('[CreativeVariant] Experiment created', {
            experimentId: experiment.id,
            name: experiment.name
        });

        return experiment;
    }

    /**
     * Add a variant to an experiment.
     */
    static async addVariant(
        experimentId: string,
        content: VariantContent
    ): Promise<any> {
        // Get existing variant count for label
        const existingCount = await prisma.creativeVariant.count({
            where: { experimentId }
        });

        const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const variantLabel = labels[existingCount] || `V${existingCount + 1}`;

        const variant = await prisma.creativeVariant.create({
            data: {
                experimentId,
                variantLabel,
                isControl: content.isControl || existingCount === 0,
                headlines: content.headlines || [],
                descriptions: content.descriptions || [],
                primaryTexts: content.primaryTexts || []
            }
        });

        Logger.info('[CreativeVariant] Variant added', {
            experimentId,
            variantId: variant.id,
            label: variantLabel
        });

        return variant;
    }

    /**
     * Get experiment with all variants.
     */
    static async getExperiment(experimentId: string): Promise<any> {
        return prisma.creativeExperiment.findUnique({
            where: { id: experimentId },
            include: {
                variants: {
                    orderBy: { variantLabel: 'asc' }
                }
            }
        });
    }

    /**
     * List experiments for an account.
     */
    static async listExperiments(accountId: string, status?: string): Promise<any[]> {
        return prisma.creativeExperiment.findMany({
            where: {
                accountId,
                ...(status && { status })
            },
            include: {
                variants: true
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    /**
     * Refresh performance metrics for an experiment's variants.
     * Fetches latest data from ad platforms.
     */
    static async refreshExperimentMetrics(experimentId: string): Promise<void> {
        const experiment = await this.getExperiment(experimentId);
        if (!experiment) {
            throw new Error('Experiment not found');
        }

        Logger.info('[CreativeVariant] Refreshing metrics', { experimentId });

        for (const variant of experiment.variants) {
            if (!variant.externalAdId) continue;

            try {
                const metrics = await this.fetchVariantMetrics(
                    experiment.platform,
                    experiment.adAccountId,
                    variant.externalAdId
                );

                if (metrics) {
                    const ctr = metrics.impressions > 0
                        ? metrics.clicks / metrics.impressions
                        : null;
                    const conversionRate = metrics.clicks > 0
                        ? metrics.conversions / metrics.clicks
                        : null;
                    const roas = metrics.spend > 0
                        ? metrics.revenue / metrics.spend
                        : null;

                    await prisma.creativeVariant.update({
                        where: { id: variant.id },
                        data: {
                            impressions: metrics.impressions,
                            clicks: metrics.clicks,
                            conversions: metrics.conversions,
                            spend: metrics.spend,
                            revenue: metrics.revenue,
                            ctr,
                            conversionRate,
                            roas,
                            metricsUpdatedAt: new Date()
                        }
                    });
                }
            } catch (error: any) {
                Logger.error('[CreativeVariant] Failed to refresh variant metrics', {
                    variantId: variant.id,
                    error: error.message
                });
            }
        }
    }

    /**
     * Fetch metrics for a specific ad from the platform.
     * Note: Current API implementation fetches account-level insights.
     * Individual ad-level metrics require platform-specific ad ID queries.
     */
    private static async fetchVariantMetrics(
        platform: string,
        _adAccountId: string,
        adId: string
    ): Promise<{
        impressions: number;
        clicks: number;
        conversions: number;
        spend: number;
        revenue: number;
    } | null> {
        // TODO: Implement individual ad-level metrics fetching
        // Current getInsights methods fetch account-level data, not individual ads
        // For now, log and return null - metrics should be updated via platform webhooks
        // or by extending MetaAdsService/GoogleAdsService with getAdMetrics methods
        Logger.debug('[CreativeVariant] Ad-level metrics fetch not yet implemented', {
            platform,
            adId
        });

        return null;
    }

    /**
     * Calculate statistical significance between variants.
     * Uses two-proportion z-test.
     */
    static async analyzeSignificance(experimentId: string): Promise<SignificanceResult> {
        const experiment = await this.getExperiment(experimentId);
        if (!experiment) {
            throw new Error('Experiment not found');
        }

        const control = experiment.variants.find((v: any) => v.isControl);
        if (!control) {
            throw new Error('No control variant found');
        }

        const metric = experiment.primaryMetric;
        const confidenceLevel = experiment.confidenceLevel;
        const zCritical = this.getZCritical(confidenceLevel);

        const results: SignificanceResult['variants'] = [];
        let hasWinner = false;
        let winnerId: string | undefined;

        for (const variant of experiment.variants) {
            const controlValue = this.getMetricValue(control, metric);
            const variantValue = this.getMetricValue(variant, metric);

            let pValue: number | null = null;
            let isSignificant = false;

            if (variant.impressions >= experiment.minSampleSize &&
                control.impressions >= experiment.minSampleSize) {

                // Two-proportion z-test
                const zScore = this.calculateZScore(
                    control.clicks, control.impressions,
                    variant.clicks, variant.impressions
                );

                pValue = this.zToPValue(zScore);
                isSignificant = Math.abs(zScore) > zCritical;

                // Update variant with significance data
                await prisma.creativeVariant.update({
                    where: { id: variant.id },
                    data: { pValue, isSignificant }
                });

                // Check for winner
                if (isSignificant && !variant.isControl && variantValue > controlValue) {
                    hasWinner = true;
                    winnerId = variant.id;
                }
            }

            results.push({
                id: variant.id,
                label: variant.variantLabel,
                isControl: variant.isControl,
                impressions: variant.impressions,
                metricValue: variantValue,
                pValue,
                isSignificant,
                status: variant.status
            });
        }

        const recommendation = this.generateRecommendation(
            results,
            experiment.minSampleSize,
            hasWinner
        );

        return {
            experimentId,
            hasWinner,
            winnerId,
            controlId: control.id,
            variants: results,
            recommendation
        };
    }

    /**
     * Get metric value based on experiment's primary metric.
     */
    private static getMetricValue(variant: any, metric: string): number {
        switch (metric) {
            case 'ctr':
                return variant.ctr || 0;
            case 'conversions':
                return variant.conversionRate || 0;
            case 'roas':
                return variant.roas || 0;
            default:
                return variant.ctr || 0;
        }
    }

    /**
     * Calculate z-score for two proportions.
     */
    private static calculateZScore(
        x1: number, n1: number,
        x2: number, n2: number
    ): number {
        if (n1 === 0 || n2 === 0) return 0;

        const p1 = x1 / n1;
        const p2 = x2 / n2;
        const pPooled = (x1 + x2) / (n1 + n2);

        if (pPooled === 0 || pPooled === 1) return 0;

        const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));
        return (p2 - p1) / se;
    }

    /**
     * Convert z-score to p-value (two-tailed).
     */
    private static zToPValue(z: number): number {
        // Approximation of cumulative normal distribution
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;

        const absZ = Math.abs(z);
        const t = 1 / (1 + p * absZ);
        const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ / 2);

        return 2 * (1 - y); // Two-tailed
    }

    /**
     * Get z-critical value for confidence level.
     */
    private static getZCritical(confidence: number): number {
        // Common critical values
        if (confidence >= 0.99) return 2.576;
        if (confidence >= 0.95) return 1.96;
        if (confidence >= 0.90) return 1.645;
        return 1.96;
    }

    /**
     * Generate recommendation based on analysis.
     */
    private static generateRecommendation(
        variants: SignificanceResult['variants'],
        minSampleSize: number,
        hasWinner: boolean
    ): string {
        const underSampled = variants.filter(v => v.impressions < minSampleSize);

        if (underSampled.length > 0) {
            return `Experiment needs more data. ${underSampled.length} variant(s) have less than ${minSampleSize} impressions.`;
        }

        if (hasWinner) {
            const winner = variants.find(v => v.isSignificant && !v.isControl);
            return `Variant ${winner?.label} is performing significantly better than control. Consider promoting it.`;
        }

        const losers = variants.filter(v => v.isSignificant && !v.isControl && v.metricValue < (variants.find(c => c.isControl)?.metricValue || 0));
        if (losers.length > 0) {
            return `${losers.length} variant(s) performing significantly worse than control. Consider pausing them.`;
        }

        return 'No statistically significant difference detected yet. Continue running the experiment.';
    }

    /**
     * Check all running experiments and auto-pause losers.
     */
    static async checkAndPauseLosers(): Promise<number> {
        const experiments = await prisma.creativeExperiment.findMany({
            where: { status: 'RUNNING' },
            include: { variants: true }
        });

        let pausedCount = 0;

        for (const experiment of experiments) {
            try {
                const analysis = await this.analyzeSignificance(experiment.id);
                const control = analysis.variants.find(v => v.isControl);

                if (!control) continue;

                for (const variant of analysis.variants) {
                    if (variant.isControl) continue;
                    if (variant.status === 'PAUSED' || variant.status === 'LOSER') continue;

                    // Check if variant is a significant loser
                    if (variant.isSignificant && variant.metricValue < control.metricValue) {
                        await prisma.creativeVariant.update({
                            where: { id: variant.id },
                            data: { status: 'LOSER' }
                        });

                        // TODO: Pause the actual ad in the platform
                        // await this.pauseAdInPlatform(experiment.platform, variant.externalAdId);

                        pausedCount++;

                        Logger.info('[CreativeVariant] Auto-paused underperforming variant', {
                            experimentId: experiment.id,
                            variantId: variant.id,
                            variantLabel: variant.label
                        });
                    }
                }
            } catch (error: any) {
                Logger.error('[CreativeVariant] Failed to analyze experiment', {
                    experimentId: experiment.id,
                    error: error.message
                });
            }
        }

        return pausedCount;
    }

    /**
     * Conclude an experiment and declare a winner.
     */
    static async concludeExperiment(
        experimentId: string,
        winnerId?: string
    ): Promise<void> {
        const experiment = await this.getExperiment(experimentId);
        if (!experiment) {
            throw new Error('Experiment not found');
        }

        // If no winner specified, run analysis to find one
        if (!winnerId) {
            const analysis = await this.analyzeSignificance(experimentId);
            winnerId = analysis.winnerId;
        }

        // Update experiment status
        await prisma.creativeExperiment.update({
            where: { id: experimentId },
            data: {
                status: 'COMPLETED',
                endedAt: new Date()
            }
        });

        // Mark winner
        if (winnerId) {
            await prisma.creativeVariant.update({
                where: { id: winnerId },
                data: { status: 'WINNER' }
            });

            // Mark non-winners as losers
            await prisma.creativeVariant.updateMany({
                where: {
                    experimentId,
                    id: { not: winnerId },
                    status: 'ACTIVE'
                },
                data: { status: 'LOSER' }
            });
        }

        Logger.info('[CreativeVariant] Experiment concluded', {
            experimentId,
            winnerId
        });
    }

    /**
     * Pause an experiment.
     */
    static async pauseExperiment(experimentId: string): Promise<void> {
        await prisma.creativeExperiment.update({
            where: { id: experimentId },
            data: { status: 'PAUSED' }
        });
    }

    /**
     * Resume a paused experiment.
     */
    static async resumeExperiment(experimentId: string): Promise<void> {
        await prisma.creativeExperiment.update({
            where: { id: experimentId },
            data: { status: 'RUNNING' }
        });
    }

    /**
     * Process all accounts - refresh metrics for all running experiments.
     * Called by the scheduler.
     */
    static async refreshAllExperiments(): Promise<{ refreshed: number }> {
        const experiments = await prisma.creativeExperiment.findMany({
            where: { status: 'RUNNING' }
        });

        let refreshed = 0;

        for (const experiment of experiments) {
            try {
                await this.refreshExperimentMetrics(experiment.id);
                refreshed++;
            } catch (error: any) {
                Logger.error('[CreativeVariant] Failed to refresh experiment', {
                    experimentId: experiment.id,
                    error: error.message
                });
            }
        }

        return { refreshed };
    }
}
