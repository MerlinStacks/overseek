/**
 * Ad Action Executor
 * 
 * Centralized execution engine for scheduled ad actions.
 * Validates, executes, and logs budget changes and status updates.
 * Part of AI Co-Pilot v2 - Phase 3: Campaign Automation.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { AdsService } from '../ads';

interface ExecutionResult {
    success: boolean;
    actionId: string;
    actionType: string;
    platform: string;
    error?: string;
    resultData?: Record<string, unknown>;
}

interface ProcessResult {
    processed: number;
    succeeded: number;
    failed: number;
    results: ExecutionResult[];
}

/**
 * Executes scheduled ad actions across platforms.
 * Handles budget changes, status updates, and logs all activity.
 */
export class AdActionExecutor {
    /**
     * Process all pending scheduled actions that are ready for execution.
     * Called by the scheduler every 15 minutes.
     */
    static async processPendingActions(): Promise<ProcessResult> {
        const now = new Date();

        // Find actions ready for auto-execution
        const pendingActions = await prisma.scheduledAdAction.findMany({
            where: {
                status: 'pending',
                autoExecute: true,
                scheduledFor: { lte: now },
                OR: [
                    { executeAfter: null },
                    { executeAfter: { lte: now } }
                ]
            },
            orderBy: { scheduledFor: 'asc' },
            take: 50 // Process in batches
        });

        Logger.info(`[AdActionExecutor] Found ${pendingActions.length} pending auto-execute actions`);

        const results: ExecutionResult[] = [];
        let succeeded = 0;
        let failed = 0;

        for (const action of pendingActions) {
            try {
                const result = await this.executeAction(action.id);
                results.push(result);

                if (result.success) {
                    succeeded++;
                } else {
                    failed++;
                }
            } catch (error: any) {
                failed++;
                results.push({
                    success: false,
                    actionId: action.id,
                    actionType: action.actionType,
                    platform: action.platform,
                    error: error.message
                });
            }
        }

        return {
            processed: pendingActions.length,
            succeeded,
            failed,
            results
        };
    }

    /**
     * Execute a specific scheduled action by ID.
     * Validates spend caps, executes the action, and logs the result.
     */
    static async executeAction(actionId: string): Promise<ExecutionResult> {
        const action = await prisma.scheduledAdAction.findUnique({
            where: { id: actionId }
        });

        if (!action) {
            throw new Error('Scheduled action not found');
        }

        if (action.status !== 'pending') {
            throw new Error(`Action already ${action.status}`);
        }

        const { actionType, platform, adAccountId, campaignId, parameters } = action;
        const params = parameters as Record<string, any>;

        Logger.info('[AdActionExecutor] Executing action', {
            actionId,
            actionType,
            platform,
            campaignId
        });

        // Validate spend cap if applicable
        if (action.maxDailySpend && actionType.includes('increase')) {
            const validation = await this.validateSpendCap(
                adAccountId!,
                params.newBudget || params.amount,
                action.maxDailySpend
            );

            if (!validation.allowed) {
                await this.markActionFailed(actionId, validation.reason!);
                return {
                    success: false,
                    actionId,
                    actionType,
                    platform,
                    error: validation.reason
                };
            }
        }

        try {
            let success = false;
            let resultData: Record<string, unknown> = {};

            if (platform === 'meta') {
                success = await this.executeMetaAction(adAccountId!, campaignId!, actionType, params);
            } else if (platform === 'google') {
                success = await this.executeGoogleAction(adAccountId!, campaignId!, actionType, params);
            }

            if (success) {
                await this.markActionExecuted(actionId, resultData);
                await this.logAction(action, 'completed');

                return {
                    success: true,
                    actionId,
                    actionType,
                    platform,
                    resultData
                };
            } else {
                const error = 'Action execution returned false';
                await this.markActionFailed(actionId, error);
                return { success: false, actionId, actionType, platform, error };
            }

        } catch (error: any) {
            await this.markActionFailed(actionId, error.message);
            await this.logAction(action, 'failed', error.message);

            return {
                success: false,
                actionId,
                actionType,
                platform,
                error: error.message
            };
        }
    }

    /**
     * Execute a Meta Ads action.
     */
    private static async executeMetaAction(
        adAccountId: string,
        campaignId: string,
        actionType: string,
        params: Record<string, any>
    ): Promise<boolean> {
        const amount = params.newBudget || params.amount;

        switch (actionType) {
            case 'budget_increase':
            case 'budget_decrease':
                if (!amount) throw new Error('Budget amount required');
                return AdsService.updateMetaCampaignBudget(adAccountId, campaignId, amount);

            case 'pause':
                return AdsService.updateMetaCampaignStatus(adAccountId, campaignId, 'PAUSED');

            case 'enable':
                return AdsService.updateMetaCampaignStatus(adAccountId, campaignId, 'ACTIVE');

            default:
                throw new Error(`Unknown Meta action type: ${actionType}`);
        }
    }

    /**
     * Execute a Google Ads action.
     */
    private static async executeGoogleAction(
        adAccountId: string,
        campaignId: string,
        actionType: string,
        params: Record<string, any>
    ): Promise<boolean> {
        const amount = params.newBudget || params.amount;

        switch (actionType) {
            case 'budget_increase':
            case 'budget_decrease':
                if (!amount) throw new Error('Budget amount required');
                return AdsService.updateGoogleCampaignBudget(adAccountId, campaignId, amount);

            case 'pause':
                return AdsService.updateGoogleCampaignStatus(adAccountId, campaignId, 'PAUSED');

            case 'enable':
                return AdsService.updateGoogleCampaignStatus(adAccountId, campaignId, 'ENABLED');

            default:
                throw new Error(`Unknown Google action type: ${actionType}`);
        }
    }

    /**
     * Validate that a budget increase won't exceed the daily spend cap.
     */
    private static async validateSpendCap(
        adAccountId: string,
        proposedBudget: number,
        maxDailySpend: number
    ): Promise<{ allowed: boolean; reason?: string }> {
        if (proposedBudget > maxDailySpend) {
            return {
                allowed: false,
                reason: `Proposed budget $${proposedBudget} exceeds daily cap $${maxDailySpend}`
            };
        }

        // Could add more sophisticated checks here:
        // - Sum of all campaign budgets for the day
        // - Account-level spend limits
        // - Platform-specific restrictions

        return { allowed: true };
    }

    /**
     * Mark action as executed.
     */
    private static async markActionExecuted(
        actionId: string,
        resultData: Record<string, unknown>
    ): Promise<void> {
        await prisma.scheduledAdAction.update({
            where: { id: actionId },
            data: {
                status: 'executed',
                executedAt: new Date(),
                resultData: resultData as any
            }
        });
    }

    /**
     * Mark action as failed.
     */
    private static async markActionFailed(actionId: string, error: string): Promise<void> {
        await prisma.scheduledAdAction.update({
            where: { id: actionId },
            data: {
                status: 'failed',
                executedAt: new Date(),
                error
            }
        });
    }

    /**
     * Log the action result to AdActionLog for audit trail.
     */
    private static async logAction(
        action: any,
        status: 'completed' | 'failed',
        error?: string
    ): Promise<void> {
        await prisma.adActionLog.create({
            data: {
                accountId: action.accountId,
                adAccountId: action.adAccountId || '',
                campaignId: action.campaignId || '',
                actionType: action.actionType,
                platform: action.platform,
                parameters: action.parameters as any,
                status,
                executedAt: new Date(),
                error
            }
        });
    }
}
