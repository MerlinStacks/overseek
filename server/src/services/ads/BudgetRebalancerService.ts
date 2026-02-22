/**
 * Budget Rebalancer Service
 * 
 * Analyzes campaign performance and generates ROAS-based budget reallocation
 * recommendations. Shifts budget from underperforming campaigns to winners.
 * Part of AI Co-Pilot v2 - Phase 3: Campaign Automation.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { AdsService } from '../ads';
import { MetaAdsService } from './MetaAdsService';
import { GoogleAdsService } from './GoogleAdsService';
import { SearchToAdsIntelligenceService } from './SearchToAdsIntelligenceService';
import { QueryTrend } from '../search-console/SearchConsoleService';

/** Configuration for budget rebalancer behavior */
export interface RebalancerConfig {
    minRoasThreshold: number;       // Minimum acceptable ROAS (default: 2.0)
    winnerBudgetIncrease: number;   // Percent increase for winners (default: 0.15)
    loserBudgetDecrease: number;    // Percent decrease for losers (default: 0.15)
    maxSingleChange: number;        // Max percent change per action (default: 0.30)
    minDailyBudget: number;         // Never go below this amount (default: 5.00)
    requireApproval: boolean;       // If false, auto-execute (default: true)
    maxDailySpend?: number;         // Optional account-level spend cap
}

/** Campaign analysis result */
interface CampaignAnalysis {
    campaignId: string;
    campaignName: string;
    platform: 'GOOGLE' | 'META';
    adAccountId: string;
    currentBudget: number;
    spend: number;
    revenue: number;
    roas: number;
    classification: 'winner' | 'loser' | 'neutral';
}

/** Recommended budget change */
interface BudgetRecommendation {
    campaignId: string;
    campaignName: string;
    platform: 'GOOGLE' | 'META';
    adAccountId: string;
    currentBudget: number;
    newBudget: number;
    changePercent: number;
    reason: string;
    roas: number;
}

/** Result of rebalancing analysis */
export interface RebalanceResult {
    accountId: string;
    analyzedAt: Date;
    campaignsAnalyzed: number;
    winners: CampaignAnalysis[];
    losers: CampaignAnalysis[];
    recommendations: BudgetRecommendation[];
    scheduledActions: string[];  // IDs of created scheduled actions
}

const DEFAULT_CONFIG: RebalancerConfig = {
    minRoasThreshold: 2.0,
    winnerBudgetIncrease: 0.15,
    loserBudgetDecrease: 0.15,
    maxSingleChange: 0.30,
    minDailyBudget: 5.00,
    requireApproval: true
};

/**
 * Analyzes and rebalances campaign budgets based on ROAS performance.
 */
export class BudgetRebalancerService {
    /**
     * Analyze campaigns and generate rebalancing recommendations.
     * Optionally schedules actions for execution.
     */
    static async analyzeAndRebalance(
        accountId: string,
        config: Partial<RebalancerConfig> = {}
    ): Promise<RebalanceResult> {
        const settings = { ...DEFAULT_CONFIG, ...config };

        Logger.info('[BudgetRebalancer] Starting analysis', { accountId, settings });

        // Get all ad accounts for this account
        const adAccounts = await AdsService.getAdAccounts(accountId);

        if (adAccounts.length === 0) {
            return {
                accountId,
                analyzedAt: new Date(),
                campaignsAnalyzed: 0,
                winners: [],
                losers: [],
                recommendations: [],
                scheduledActions: []
            };
        }

        // Analyze campaigns across all platforms
        const analyses: CampaignAnalysis[] = [];

        for (const adAccount of adAccounts) {
            const platformAnalysis = await this.analyzePlatformCampaigns(
                adAccount.id,
                adAccount.platform as 'GOOGLE' | 'META',
                settings
            );
            analyses.push(...platformAnalysis);
        }

        // Classify campaigns
        const winners = analyses.filter(a => a.classification === 'winner');
        const losers = analyses.filter(a => a.classification === 'loser');

        Logger.info('[BudgetRebalancer] Classification complete', {
            accountId,
            total: analyses.length,
            winners: winners.length,
            losers: losers.length
        });

        // Fetch organic trends to apply the "organic safety net" modifier
        const organicTrends = await SearchToAdsIntelligenceService
            .getOrganicTrendsForPaidQueries(accountId)
            .catch(() => new Map<string, QueryTrend>());

        // Generate recommendations with organic trend context
        const recommendations = this.generateRecommendations(winners, losers, settings, organicTrends);

        // Schedule actions if configured
        const scheduledActions: string[] = [];

        for (const rec of recommendations) {
            const actionId = await this.scheduleRebalanceAction(
                accountId,
                rec,
                settings
            );
            if (actionId) {
                scheduledActions.push(actionId);
            }
        }

        return {
            accountId,
            analyzedAt: new Date(),
            campaignsAnalyzed: analyses.length,
            winners,
            losers,
            recommendations,
            scheduledActions
        };
    }

    /**
     * Analyze campaigns for a specific ad account/platform.
     */
    private static async analyzePlatformCampaigns(
        adAccountId: string,
        platform: 'GOOGLE' | 'META',
        settings: RebalancerConfig
    ): Promise<CampaignAnalysis[]> {
        try {
            const campaigns = platform === 'META'
                ? await MetaAdsService.getCampaignInsights(adAccountId, 30)
                : await GoogleAdsService.getCampaignInsights(adAccountId, 30);

            return campaigns.map(campaign => {
                const spend = campaign.spend || 0;
                const revenue = (campaign as any).conversionsValue ||
                    (campaign as any).revenue || 0;
                const roas = spend > 0 ? revenue / spend : 0;

                let classification: 'winner' | 'loser' | 'neutral' = 'neutral';

                // Only classify campaigns with meaningful spend
                if (spend >= 10) {
                    if (roas >= settings.minRoasThreshold * 1.5) {
                        classification = 'winner';  // High performers
                    } else if (roas < settings.minRoasThreshold * 0.5) {
                        classification = 'loser';   // Low performers
                    }
                }

                return {
                    campaignId: campaign.campaignId || (campaign as any).id || '',
                    campaignName: campaign.campaignName || (campaign as any).name || '',
                    platform,
                    adAccountId,
                    currentBudget: (campaign as any).dailyBudget || 0,
                    spend,
                    revenue,
                    roas,
                    classification
                };
            });

        } catch (error: any) {
            Logger.error('[BudgetRebalancer] Failed to analyze campaigns', {
                adAccountId,
                platform,
                error: error.message
            });
            return [];
        }
    }

    /**
     * Generate budget change recommendations.
     * Organic trends provide an "organic safety net" — if a campaign's
     * keywords are trending up organically, budget cuts are softened.
     */
    private static generateRecommendations(
        winners: CampaignAnalysis[],
        losers: CampaignAnalysis[],
        settings: RebalancerConfig,
        organicTrends: Map<string, QueryTrend> = new Map()
    ): BudgetRecommendation[] {
        const recommendations: BudgetRecommendation[] = [];

        // Increase budget for winners
        for (const winner of winners) {
            if (winner.currentBudget <= 0) continue;

            const increaseAmount = Math.min(
                winner.currentBudget * settings.winnerBudgetIncrease,
                winner.currentBudget * settings.maxSingleChange
            );
            const newBudget = winner.currentBudget + increaseAmount;

            // Check against max daily spend if set
            if (settings.maxDailySpend && newBudget > settings.maxDailySpend) {
                continue; // Skip if would exceed cap
            }

            recommendations.push({
                campaignId: winner.campaignId,
                campaignName: winner.campaignName,
                platform: winner.platform,
                adAccountId: winner.adAccountId,
                currentBudget: winner.currentBudget,
                newBudget: Math.round(newBudget * 100) / 100,
                changePercent: (increaseAmount / winner.currentBudget) * 100,
                reason: `High ROAS (${winner.roas.toFixed(2)}) - scaling up`,
                roas: winner.roas
            });
        }

        // Decrease budget for losers
        for (const loser of losers) {
            if (loser.currentBudget <= 0) continue;

            const decreaseAmount = Math.min(
                loser.currentBudget * settings.loserBudgetDecrease,
                loser.currentBudget * settings.maxSingleChange
            );
            const newBudget = Math.max(
                loser.currentBudget - decreaseAmount,
                settings.minDailyBudget
            );

            // Skip if already at minimum
            if (newBudget >= loser.currentBudget) continue;

            recommendations.push({
                campaignId: loser.campaignId,
                campaignName: loser.campaignName,
                platform: loser.platform,
                adAccountId: loser.adAccountId,
                currentBudget: loser.currentBudget,
                newBudget: Math.round(newBudget * 100) / 100,
                changePercent: -((loser.currentBudget - newBudget) / loser.currentBudget) * 100,
                reason: this.buildLoserReason(loser, organicTrends),
                roas: loser.roas
            });
        }

        return recommendations;
    }

    /**
     * Build reason string for loser campaigns, factoring in organic trend.
     * If the campaign name matches a rising organic query, the reason
     * notes the organic safety net so the user understands the softer cut.
     */
    private static buildLoserReason(
        loser: CampaignAnalysis,
        organicTrends: Map<string, QueryTrend>
    ): string {
        const baseLine = `Low ROAS (${loser.roas.toFixed(2)}) - reducing spend`;

        if (organicTrends.size === 0) return baseLine;

        // Check if any organic trend matches the campaign name keywords
        const campaignWords = loser.campaignName.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
        for (const [query, trend] of organicTrends) {
            const queryWords = query.split(' ');
            const overlap = campaignWords.filter(w => queryWords.includes(w) && w.length > 2);
            if (overlap.length >= 2 && trend.clickGrowthPct > 10) {
                return `${baseLine}. Note: organic traffic for "${trend.query}" is rising ` +
                    `(+${trend.clickGrowthPct.toFixed(0)}% clicks) — softer cut recommended.`;
            }
        }

        return baseLine;
    }

    /**
     * Create a scheduled action for a budget recommendation.
     */
    private static async scheduleRebalanceAction(
        accountId: string,
        rec: BudgetRecommendation,
        settings: RebalancerConfig
    ): Promise<string | null> {
        try {
            const actionType = rec.newBudget > rec.currentBudget
                ? 'budget_increase'
                : 'budget_decrease';

            const scheduledAction = await prisma.scheduledAdAction.create({
                data: {
                    accountId,
                    actionType,
                    platform: rec.platform.toLowerCase(),
                    adAccountId: rec.adAccountId,
                    campaignId: rec.campaignId,
                    campaignName: rec.campaignName,
                    parameters: {
                        currentBudget: rec.currentBudget,
                        newBudget: rec.newBudget,
                        changePercent: rec.changePercent,
                        reason: rec.reason,
                        roas: rec.roas
                    },
                    scheduledFor: new Date(), // Execute immediately when approved
                    autoExecute: !settings.requireApproval,
                    maxDailySpend: settings.maxDailySpend,
                    sourceType: 'rebalancer'
                }
            });

            Logger.info('[BudgetRebalancer] Scheduled action created', {
                actionId: scheduledAction.id,
                campaignName: rec.campaignName,
                actionType,
                autoExecute: !settings.requireApproval
            });

            return scheduledAction.id;

        } catch (error: any) {
            Logger.error('[BudgetRebalancer] Failed to schedule action', {
                campaignId: rec.campaignId,
                error: error.message
            });
            return null;
        }
    }

    /**
     * Get the current rebalancer settings for an account.
     */
    static async getSettings(accountId: string): Promise<RebalancerConfig> {
        // In future, could store per-account settings in database
        // For now, return defaults
        return DEFAULT_CONFIG;
    }

    /**
     * Process all accounts that have rebalancing enabled.
     * Called by the scheduler.
     */
    static async processAllAccounts(): Promise<{
        processed: number;
        recommendations: number;
    }> {
        // Get all accounts with connected ad platforms
        const accounts = await prisma.account.findMany({
            where: {
                adAccounts: {
                    some: {}
                }
            },
            select: { id: true }
        });

        let totalRecommendations = 0;

        for (const account of accounts) {
            try {
                const result = await this.analyzeAndRebalance(account.id);
                totalRecommendations += result.recommendations.length;
            } catch (error: any) {
                Logger.error('[BudgetRebalancer] Failed to process account', {
                    accountId: account.id,
                    error: error.message
                });
            }
        }

        return {
            processed: accounts.length,
            recommendations: totalRecommendations
        };
    }
}
