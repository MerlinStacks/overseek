/**
 * Ads Actions Routes
 * 
 * Execute, schedule, and manage ad campaign actions.
 * Extracted from ads.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { AdsService } from '../../services/ads';
import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';
import { getAdsAccountIdOrReply, parsePositiveInt } from './routeHelpers';

interface ScheduleActionBody {
    actionType: string;
    platform: 'google' | 'meta';
    campaignId: string;
    campaignName?: string;
    parameters: {
        currentBudget?: number;
        newBudget?: number;
        changeAmount?: number;
        adAccountId?: string;
    };
    scheduledFor: string;
    recommendationId?: string;
}

function requiresBudgetAmount(actionType: string) {
    return actionType === 'budget_increase' || actionType === 'budget_decrease';
}

function isStatusAction(actionType: string) {
    return actionType === 'pause' || actionType === 'enable';
}

async function executeStatusAction(
    platform: 'google' | 'meta',
    adAccountId: string,
    campaignId: string,
    actionType: 'pause' | 'enable',
) {
    if (platform === 'meta') {
        const status = actionType === 'pause' ? 'PAUSED' : 'ACTIVE';
        return AdsService.updateMetaCampaignStatus(adAccountId, campaignId, status);
    }

    const status = actionType === 'pause' ? 'PAUSED' : 'ENABLED';
    return AdsService.updateGoogleCampaignStatus(adAccountId, campaignId, status);
}

function getPlatformAccounts(
    accounts: Array<{ id: string; platform: string }>,
    platform: 'google' | 'meta' | 'both',
) {
    if (platform === 'both') {
        return accounts.filter((account) => account.platform === 'GOOGLE' || account.platform === 'META');
    }
    return accounts.filter((account) => account.platform === platform.toUpperCase());
}

function resolveAdAccountId(
    platformAccounts: Array<{ id: string }>,
    requestedAdAccountId: string | undefined,
): string | null {
    if (requestedAdAccountId) return requestedAdAccountId;
    if (platformAccounts.length === 1) return platformAccounts[0].id;
    return null;
}

export const adsActionsRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * POST /execute-action - Execute an actionable recommendation
     */
    fastify.post<{ Body: { actionType: string; platform: 'google' | 'meta' | 'both'; campaignId: string; parameters: any } }>('/execute-action', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const { actionType, platform, campaignId, parameters } = request.body;
            const safeParams = { ...request.body, ...(parameters || {}) };
            const { amount } = safeParams;

            Logger.info('Executing Ad Action', { accountId, actionType, platform, campaignId, parameters: safeParams });

            // Find the ad account
            const accounts = await AdsService.getAdAccounts(accountId);
            const platformAccounts = getPlatformAccounts(accounts, platform);

            if (platformAccounts.length === 0) {
                const platformLabel = platform === 'both' ? 'Google or Meta' : platform;
                return reply.code(400).send({ error: `No connected ${platformLabel} ad accounts found` });
            }

            const adAccountId = resolveAdAccountId(platformAccounts, parameters.adAccountId);
            if (!adAccountId) {
                return reply.code(400).send({ error: 'Multiple ad accounts found. Please specify adAccountId.' });
            }

            const targetAccount = platformAccounts.find((account) => account.id === adAccountId);

            if (!targetAccount) {
                return reply.code(404).send({ error: 'Target ad account not found' });
            }

            let success = false;

            if (platform === 'meta') {
                if (requiresBudgetAmount(actionType)) {
                    if (!amount) return reply.code(400).send({ error: 'Amount is required for budget update' });
                    success = await AdsService.updateMetaCampaignBudget(targetAccount.id, campaignId, amount);
                } else if (isStatusAction(actionType)) {
                    success = await executeStatusAction(platform, targetAccount.id, campaignId, actionType);
                }
            } else if (platform === 'google') {
                if (requiresBudgetAmount(actionType)) {
                    if (!amount) return reply.code(400).send({ error: 'Amount is required for budget update' });
                    success = await AdsService.updateGoogleCampaignBudget(targetAccount.id, campaignId, amount);
                } else if (isStatusAction(actionType)) {
                    success = await executeStatusAction(platform, targetAccount.id, campaignId, actionType);
                } else if (actionType === 'keyword_add' || actionType === 'add_keyword') {
                    const { adGroupId, keyword, matchType, bid, suggestedCpc } = safeParams;
                    if (!adGroupId || !keyword || !matchType) {
                        return reply.code(400).send({ error: 'Missing required fields for keyword add: adGroupId, keyword, matchType' });
                    }
                    const finalBid = bid || suggestedCpc;
                    success = await AdsService.addGoogleSearchKeyword(
                        targetAccount.id, campaignId, adGroupId, keyword, matchType,
                        finalBid ? parseFloat(String(finalBid)) : undefined
                    );
                }
            }

            if (success) {
                Logger.info('Ad Action Executed Successfully', { campaignId, actionType });

                // Audit log
                await prisma.adActionLog.create({
                    data: {
                        accountId,
                        adAccountId: targetAccount.id,
                        campaignId,
                        actionType,
                        platform,
                        parameters: parameters as any,
                        status: 'completed',
                        executedAt: new Date()
                    }
                }).catch(err => {
                    Logger.warn('Failed to log ad action', { error: err.message });
                });

                return { success: true };
            } else {
                return reply.code(500).send({ error: 'Failed to execute action' });
            }
        } catch (error: any) {
            Logger.error('Ad Action Execution Failed', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * POST /schedule-action - Schedule an action for later execution
     */
    fastify.post<{ Body: ScheduleActionBody }>('/schedule-action', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const { actionType, platform, campaignId, campaignName, parameters, scheduledFor, recommendationId } = request.body;

            if (!scheduledFor) {
                return reply.code(400).send({ error: 'scheduledFor date is required' });
            }

            const scheduledDate = new Date(scheduledFor);
            if (scheduledDate <= new Date()) {
                return reply.code(400).send({ error: 'Scheduled time must be in the future' });
            }

            const accounts = await AdsService.getAdAccounts(accountId);
            const platformAccounts = getPlatformAccounts(accounts, platform);
            const adAccountId = resolveAdAccountId(platformAccounts, parameters.adAccountId) ?? undefined;

            const scheduled = await prisma.scheduledAdAction.create({
                data: {
                    accountId,
                    actionType,
                    platform,
                    adAccountId,
                    campaignId,
                    campaignName,
                    parameters: parameters as any,
                    scheduledFor: scheduledDate,
                    status: 'pending',
                    recommendationId
                }
            });

            Logger.info('Ad Action Scheduled', {
                id: scheduled.id, accountId, actionType, campaignId,
                scheduledFor: scheduledDate.toISOString()
            });

            return {
                success: true,
                scheduledAction: {
                    id: scheduled.id,
                    scheduledFor: scheduled.scheduledFor,
                    status: scheduled.status
                }
            };
        } catch (error: any) {
            Logger.error('Failed to schedule ad action', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /scheduled-actions - List scheduled actions
     */
    fastify.get('/scheduled-actions', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const actions = await prisma.scheduledAdAction.findMany({
                where: { accountId },
                orderBy: { scheduledFor: 'asc' },
                take: 50
            });
            return actions;
        } catch (error: any) {
            Logger.error('Failed to list scheduled actions', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * DELETE /scheduled-actions/:id - Cancel a scheduled action
     */
    fastify.delete<{ Params: { id: string } }>('/scheduled-actions/:id', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const { id } = request.params;

            const action = await prisma.scheduledAdAction.findFirst({
                where: { id, accountId, status: 'pending' }
            });

            if (!action) {
                return reply.code(404).send({ error: 'Scheduled action not found or already executed' });
            }

            await prisma.scheduledAdAction.update({
                where: { id },
                data: { status: 'cancelled' }
            });

            Logger.info('Scheduled action cancelled', { id, accountId });
            return { success: true };
        } catch (error: any) {
            Logger.error('Failed to cancel scheduled action', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * POST /create-campaign - Create a new ad campaign (Wizard)
     */
    fastify.post<{ Body: { type: 'SEARCH' | 'PMAX'; name: string; budget: number; keywords?: any[]; adCopy?: any; productIds?: string[] } }>('/create-campaign', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const { type, name, budget, keywords, adCopy } = request.body;
            const { CampaignBuilderService } = await import('../../services/ads/CampaignBuilderService');

            const accounts = await AdsService.getAdAccounts(accountId);
            const googleAccount = accounts.find(a => a.platform === 'GOOGLE');

            if (!googleAccount) {
                return reply.code(400).send({ error: 'No Google Ads account connected' });
            }

            if (type === 'SEARCH') {
                if (!keywords || !adCopy) {
                    return reply.code(400).send({ error: 'Keywords and Ad Copy are required for Search campaigns' });
                }
                const result = await CampaignBuilderService.createSearchCampaign(
                    googleAccount.id,
                    { name, dailyBudget: budget },
                    keywords,
                    adCopy
                );
                return result;
            } else if (type === 'PMAX') {
                return reply.code(501).send({ error: 'Performance Max creation not yet enabled' });
            }

            return reply.code(400).send({ error: 'Invalid campaign type' });
        } catch (error: any) {
            Logger.error('Failed to create campaign', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /roi/summary - Get ROI attribution summary
     */
    fastify.get<{ Querystring: { days?: string } }>('/roi/summary', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const { CoPilotROIService } = await import('../../services/CoPilotROIService');
            const days = parsePositiveInt(request.query.days, 30);
            const summary = await CoPilotROIService.getROISummary(accountId, days);
            return { success: true, data: summary };
        } catch (error: any) {
            Logger.error('Failed to get ROI summary', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /roi/quick-stats - Get quick stats for dashboard widget
     */
    fastify.get('/roi/quick-stats', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const { CoPilotROIService } = await import('../../services/CoPilotROIService');
            const stats = await CoPilotROIService.getQuickStats(accountId);
            return { success: true, data: stats };
        } catch (error: any) {
            Logger.error('Failed to get ROI quick stats', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /action-history - Get audit trail of AI actions
     */
    fastify.get<{ Querystring: { page?: string; limit?: string } }>('/action-history', async (request, reply) => {
        const accountId = getAdsAccountIdOrReply(request, reply);
        if (!accountId) return;

        try {
            const page = parsePositiveInt(request.query.page, 1);
            const limit = Math.min(parsePositiveInt(request.query.limit, 20), 100);
            const skip = (page - 1) * limit;

            const [actions, total] = await Promise.all([
                prisma.adActionLog.findMany({
                    where: { accountId },
                    orderBy: { createdAt: 'desc' },
                    take: limit,
                    skip
                }),
                prisma.adActionLog.count({ where: { accountId } })
            ]);

            return {
                success: true,
                data: {
                    actions,
                    pagination: {
                        page,
                        limit,
                        total,
                        totalPages: Math.ceil(total / limit)
                    }
                }
            };
        } catch (error: any) {
            Logger.error('Failed to get action history', { error });
            return reply.code(500).send({ error: error.message });
        }
    });
};
