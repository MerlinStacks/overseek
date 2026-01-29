/**
 * Marketing Scheduler
 * 
 * Handles all marketing/ads-related scheduling:
 * - Abandoned cart checks (15 min)
 * - Report schedules (15 min)
 * - Ad alerts (4 hours)
 * - Outcome assessment (daily)
 * - Automation ticker (1 min)
 */
import { QueueFactory } from '../queue/QueueFactory';
import { Logger } from '../../utils/logger';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { AutomationEngine } from '../AutomationEngine';

const automationEngine = new AutomationEngine();

export class MarketingScheduler {
    private static queue = QueueFactory.createQueue('scheduler');
    private static automationInterval: NodeJS.Timeout | null = null;
    private static abandonedCartInterval: NodeJS.Timeout | null = null;
    private static reportInterval: NodeJS.Timeout | null = null;

    /**
     * Register all marketing-related repeatable jobs
     */
    static async register() {
        // Ad Alerts (Every 4 hours)
        await this.queue.add('ad-alerts', {}, {
            repeat: { pattern: '0 */4 * * *' },
            jobId: 'ad-alerts-4h'
        });
        Logger.info('Scheduled Ad Alert Check (Every 4 hours)');

        // Outcome Assessment (Daily at 3 AM UTC)
        await this.queue.add('outcome-assessment', {}, {
            repeat: { pattern: '0 3 * * *' },
            jobId: 'outcome-assessment-daily'
        });
        Logger.info('Scheduled Recommendation Outcome Assessment (Daily at 3 AM UTC)');

        // Weekly Performance Digest (Monday at 9 AM UTC)
        await this.queue.add('weekly-digest', {}, {
            repeat: { pattern: '0 9 * * 1' },
            jobId: 'weekly-digest-monday'
        });
        Logger.info('Scheduled Weekly Performance Digest (Monday at 9 AM UTC)');

        // Weekly Audience Refresh (Sunday at 2 AM UTC)
        // Refreshes all synced audiences with updated segment members
        await this.queue.add('audience-refresh', {}, {
            repeat: { pattern: '0 2 * * 0' },
            jobId: 'audience-refresh-weekly'
        });
        Logger.info('Scheduled Weekly Audience Refresh (Sunday at 2 AM UTC)');

        // Budget Rebalancer Analysis (Every 6 hours)
        // Analyzes campaigns and generates ROAS-based recommendations
        await this.queue.add('budget-rebalancer', {}, {
            repeat: { pattern: '0 */6 * * *' },
            jobId: 'budget-rebalancer-6h'
        });
        Logger.info('Scheduled Budget Rebalancer Analysis (Every 6 hours)');

        // Auto-Execute Pending Actions (Every 15 minutes)
        // Executes scheduled actions that have autoExecute enabled
        await this.queue.add('execute-pending-actions', {}, {
            repeat: { pattern: '*/15 * * * *' },
            jobId: 'execute-pending-actions-15m'
        });
        Logger.info('Scheduled Auto-Execute Pending Actions (Every 15 minutes)');

        // Experiment Metrics Refresh (Every 4 hours)
        // Refreshes performance metrics for active A/B experiments
        await this.queue.add('experiment-metrics-refresh', {}, {
            repeat: { pattern: '0 */4 * * *' },
            jobId: 'experiment-metrics-4h'
        });
        Logger.info('Scheduled Experiment Metrics Refresh (Every 4 hours)');

        // Experiment Significance Check (Daily at 6 AM UTC)
        // Analyzes experiments and auto-pauses underperforming variants
        await this.queue.add('experiment-significance-check', {}, {
            repeat: { pattern: '0 6 * * *' },
            jobId: 'experiment-significance-daily'
        });
        Logger.info('Scheduled Experiment Significance Check (Daily at 6 AM UTC)');
    }



    /**
     * Start all marketing-related tickers
     */
    static start() {
        // Marketing Automation (every minute)
        this.automationInterval = setInterval(
            () => automationEngine.runTicker().catch(e => Logger.error('Marketing Ticker Error', { error: e })),
            60 * 1000
        );

        // Abandoned Cart Check (every 15 mins)
        this.abandonedCartInterval = setInterval(
            () => this.checkAbandonedCarts().catch(e => Logger.error('Abandoned Cart Check Error', { error: e })),
            15 * 60 * 1000
        );

        // Report Scheduler (every 15 mins)
        this.reportInterval = setInterval(
            () => this.checkReportSchedules().catch(e => Logger.error('Report Scheduler Error', { error: e })),
            15 * 60 * 1000
        );
    }

    /**
     * Check for abandoned carts and trigger automation
     */
    static async checkAbandonedCarts() {
        const cutOffTime = new Date(Date.now() - 60 * 60 * 1000);
        const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const abandonedSessions = await prisma.analyticsSession.findMany({
            where: {
                cartValue: { gt: new Prisma.Decimal(0) },
                lastActiveAt: { lt: cutOffTime, gt: windowStart },
                email: { not: null },
                abandonedNotificationSentAt: null
            }
        });

        if (abandonedSessions.length > 0) {
            Logger.info(`[Scheduler] Found ${abandonedSessions.length} abandoned carts`);

            for (const session of abandonedSessions) {
                await automationEngine.processTrigger(session.accountId, 'ABANDONED_CART', {
                    email: session.email,
                    wooCustomerId: session.wooCustomerId,
                    cart: {
                        total: session.cartValue,
                        items: session.cartItems,
                        currency: session.currency,
                        checkoutUrl: session.currentPath
                    },
                    visitorId: session.visitorId
                });

                await prisma.analyticsSession.update({
                    where: { id: session.id },
                    data: { abandonedNotificationSentAt: new Date() }
                });
            }
        }
    }

    /**
     * Check for due report schedules and dispatch jobs
     */
    static async checkReportSchedules() {
        const now = new Date();
        const schedules = await prisma.reportSchedule.findMany({
            where: {
                isActive: true,
                OR: [
                    { nextRunAt: { lte: now } },
                    { nextRunAt: null }
                ]
            }
        });

        if (schedules.length === 0) return;

        Logger.info(`[Scheduler] Found ${schedules.length} reports to run`);

        const { QUEUES } = await import('../queue/QueueFactory');
        const queue = QueueFactory.getQueue(QUEUES.REPORTS);

        for (const schedule of schedules) {
            await queue.add('generate-report', {
                accountId: schedule.accountId,
                scheduleId: schedule.id
            });

            const nextRun = this.calculateNextRun(schedule);
            await prisma.reportSchedule.update({
                where: { id: schedule.id },
                data: { nextRunAt: nextRun }
            });
        }
    }

    /**
     * Calculate next run date for a report schedule
     */
    private static calculateNextRun(schedule: any): Date {
        const now = new Date();
        const [hour, checkMinute] = (schedule.time || '09:00').split(':').map(Number);

        let next = new Date();
        next.setHours(hour, checkMinute || 0, 0, 0);

        if (next <= now) {
            next.setDate(next.getDate() + 1);
        }

        if (schedule.frequency === 'WEEKLY') {
            const currentDayJS = next.getDay();
            const currentDayISO = currentDayJS === 0 ? 7 : currentDayJS;
            const desiredDay = schedule.dayOfWeek || 1;

            let daysToAdd = desiredDay - currentDayISO;
            if (daysToAdd < 0) daysToAdd += 7;

            next.setDate(next.getDate() + daysToAdd);
        } else if (schedule.frequency === 'MONTHLY') {
            const desiredDay = schedule.dayOfMonth || 1;
            next.setDate(desiredDay);

            if (next <= now) {
                next.setMonth(next.getMonth() + 1);
            }
        }

        return next;
    }

    /**
     * Dispatch ad alerts check for all accounts with ad accounts
     */
    static async dispatchAdAlerts() {
        Logger.info('[Scheduler] Starting ad alert check');

        try {
            const { AdAlertService } = await import('../tools/AdAlertService');

            const accountsWithAds = await prisma.adAccount.findMany({
                select: { accountId: true },
                distinct: ['accountId']
            });

            Logger.info(`[Scheduler] Checking ad alerts for ${accountsWithAds.length} accounts`);

            for (const { accountId } of accountsWithAds) {
                try {
                    const alerts = await AdAlertService.checkForAlerts(accountId);

                    if (alerts.length > 0) {
                        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                        const recentAlerts = await prisma.adAlert.findMany({
                            where: { accountId, createdAt: { gte: dayAgo } },
                            select: { type: true, campaignId: true }
                        });

                        const recentKeys = new Set(
                            recentAlerts.map(a => `${a.type}:${a.campaignId || 'all'}`)
                        );

                        const newAlerts = alerts.filter(
                            a => !recentKeys.has(`${a.type}:${a.campaignId || 'all'}`)
                        );

                        if (newAlerts.length > 0) {
                            for (const alert of newAlerts) {
                                const sanitizedData = alert.data && Object.keys(alert.data).length > 0
                                    ? JSON.parse(JSON.stringify(alert.data))
                                    : {};

                                await prisma.adAlert.create({
                                    data: {
                                        accountId,
                                        severity: alert.severity,
                                        type: alert.type,
                                        title: alert.title,
                                        message: alert.message,
                                        platform: alert.platform,
                                        campaignId: alert.campaignId,
                                        campaignName: alert.campaignName,
                                        data: sanitizedData
                                    }
                                });
                            }

                            await AdAlertService.sendCriticalAlerts(accountId, newAlerts);
                            Logger.info(`[Scheduler] Created ${newAlerts.length} new ad alerts`, { accountId });
                        }
                    }
                } catch (error) {
                    Logger.error(`[Scheduler] Ad alert check failed for account ${accountId}`, { error });
                }
            }
        } catch (error) {
            Logger.error('[Scheduler] Ad alerts dispatch failed', { error });
        }
    }

    /**
     * Assess outcomes of implemented recommendations (AI Marketing Co-Pilot Phase 5)
     */
    static async dispatchOutcomeAssessment() {
        Logger.info('[Scheduler] Starting recommendation outcome assessment');

        try {
            const { RecommendationTracker } = await import('../tools/knowledge/RecommendationTracker');
            const { MultiPeriodAnalyzer } = await import('../tools/analyzers');

            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            const pendingOutcomes = await prisma.recommendationLog.findMany({
                where: {
                    status: 'implemented',
                    implementedAt: { lte: sevenDaysAgo, gte: thirtyDaysAgo },
                    outcomeRecordedAt: null
                },
                take: 50
            });

            if (pendingOutcomes.length === 0) {
                Logger.info('[Scheduler] No recommendations pending outcome assessment');
                return;
            }

            Logger.info(`[Scheduler] Assessing outcomes for ${pendingOutcomes.length} recommendations`);

            const byAccount = new Map<string, typeof pendingOutcomes>();
            for (const rec of pendingOutcomes) {
                const list = byAccount.get(rec.accountId) || [];
                list.push(rec);
                byAccount.set(rec.accountId, list);
            }

            for (const [accountId, recommendations] of byAccount) {
                try {
                    const analysis = await MultiPeriodAnalyzer.analyze(accountId);
                    const currentRoas = analysis.combined?.['7d']?.roas || 0;

                    for (const rec of recommendations) {
                        const dataPoints = rec.dataPoints as any;
                        let roasBefore = 0;
                        if (dataPoints && Array.isArray(dataPoints)) {
                            const roasPoint = dataPoints.find((d: string) => d.includes('ROAS'));
                            if (roasPoint) {
                                const match = roasPoint.match(/[\d.]+/);
                                roasBefore = match ? parseFloat(match[0]) : 0;
                            }
                        }

                        await RecommendationTracker.recordOutcome(rec.id, {
                            roasBefore,
                            roasAfter: currentRoas,
                            notes: 'Auto-assessed by scheduler'
                        });

                        Logger.info(`[Scheduler] Recorded outcome for recommendation ${rec.id}`, {
                            roasBefore,
                            roasAfter: currentRoas,
                            change: roasBefore > 0 ? ((currentRoas - roasBefore) / roasBefore * 100).toFixed(1) + '%' : 'N/A'
                        });
                    }
                } catch (error) {
                    Logger.error(`[Scheduler] Outcome assessment failed for account ${accountId}`, { error });
                }
            }

            const { LearningService } = await import('../tools/knowledge/LearningService');
            for (const accountId of byAccount.keys()) {
                try {
                    const derived = await LearningService.deriveFromOutcomes(accountId);
                    if (derived.length > 0) {
                        Logger.info(`[Scheduler] Derived ${derived.length} new learnings for account ${accountId}`);
                    }
                } catch (error) {
                    Logger.error(`[Scheduler] Learning derivation failed for account ${accountId}`, { error });
                }
            }
        } catch (error) {
            Logger.error('[Scheduler] Outcome assessment dispatch failed', { error });
        }
    }

    /**
     * Dispatch weekly performance digests to all eligible accounts
     */
    static async dispatchWeeklyDigests() {
        Logger.info('[Scheduler] Starting weekly performance digest dispatch');

        try {
            const { PerformanceDigestService } = await import('../PerformanceDigestService');

            // Get all accounts with digest enabled (defaulting to all for now)
            // Note: Could filter by accounts with ad accounts or recent activity
            const accounts = await prisma.account.findMany({
                select: { id: true, name: true }
            });

            Logger.info(`[Scheduler] Sending weekly digests to ${accounts.length} accounts`);

            for (const account of accounts) {
                try {
                    await PerformanceDigestService.sendDigest(account.id);
                    Logger.info(`[Scheduler] Weekly digest sent for ${account.name || account.id}`);
                } catch (error) {
                    Logger.error(`[Scheduler] Failed to send digest for account ${account.id}`, { error });
                }
            }
        } catch (error) {
            Logger.error('[Scheduler] Weekly digest dispatch failed', { error });
        }
    }

    /**
     * Dispatch weekly audience refresh - updates synced audiences with fresh segment data.
     * Part of AI Co-Pilot v2 - Phase 2: Audience Intelligence.
     */
    static async dispatchAudienceRefresh() {
        try {
            const { AudienceSyncService } = await import('../ads/AudienceSyncService');

            // Get all accounts with synced audiences
            const accountsWithAudiences = await prisma.audienceSync.groupBy({
                by: ['accountId'],
                where: {
                    status: 'SYNCED',
                    isLookalike: false
                }
            });

            Logger.info(`[Scheduler] Refreshing audiences for ${accountsWithAudiences.length} accounts`);

            for (const { accountId } of accountsWithAudiences) {
                try {
                    const result = await AudienceSyncService.refreshAllAudiences(accountId);
                    Logger.info(`[Scheduler] Audience refresh complete for ${accountId}`, result);
                } catch (error) {
                    Logger.error(`[Scheduler] Failed to refresh audiences for ${accountId}`, { error });
                }
            }
        } catch (error) {
            Logger.error('[Scheduler] Audience refresh dispatch failed', { error });
        }
    }

    /**
     * Dispatch budget rebalancer analysis for all accounts.
     * Part of AI Co-Pilot v2 - Phase 3: Campaign Automation.
     */
    static async dispatchBudgetRebalancer() {
        try {
            const { BudgetRebalancerService } = await import('../ads/BudgetRebalancerService');

            Logger.info('[Scheduler] Starting budget rebalancer analysis');

            const result = await BudgetRebalancerService.processAllAccounts();

            Logger.info('[Scheduler] Budget rebalancer complete', {
                processed: result.processed,
                recommendations: result.recommendations
            });
        } catch (error) {
            Logger.error('[Scheduler] Budget rebalancer dispatch failed', { error });
        }
    }

    /**
     * Execute pending auto-execute actions.
     * Part of AI Co-Pilot v2 - Phase 3: Campaign Automation.
     */
    static async dispatchPendingActions() {
        try {
            const { AdActionExecutor } = await import('../ads/AdActionExecutor');

            const result = await AdActionExecutor.processPendingActions();

            if (result.processed > 0) {
                Logger.info('[Scheduler] Pending actions processed', {
                    processed: result.processed,
                    succeeded: result.succeeded,
                    failed: result.failed
                });
            }
        } catch (error) {
            Logger.error('[Scheduler] Pending actions dispatch failed', { error });
        }
    }

    /**
     * Refresh metrics for all running A/B experiments.
     * Part of AI Co-Pilot v2 - Phase 4: Creative A/B Engine.
     */
    static async dispatchExperimentMetricsRefresh() {
        try {
            const { CreativeVariantService } = await import('../ads/CreativeVariantService');

            Logger.info('[Scheduler] Starting experiment metrics refresh');

            const result = await CreativeVariantService.refreshAllExperiments();

            Logger.info('[Scheduler] Experiment metrics refresh complete', {
                refreshed: result.refreshed
            });
        } catch (error) {
            Logger.error('[Scheduler] Experiment metrics refresh failed', { error });
        }
    }

    /**
     * Check experiments for statistical significance and auto-pause losers.
     * Part of AI Co-Pilot v2 - Phase 4: Creative A/B Engine.
     */
    static async dispatchExperimentSignificanceCheck() {
        try {
            const { CreativeVariantService } = await import('../ads/CreativeVariantService');

            Logger.info('[Scheduler] Starting experiment significance check');

            const pausedCount = await CreativeVariantService.checkAndPauseLosers();

            if (pausedCount > 0) {
                Logger.info('[Scheduler] Experiment significance check complete', {
                    variantsPaused: pausedCount
                });
            }
        } catch (error) {
            Logger.error('[Scheduler] Experiment significance check failed', { error });
        }
    }
}

