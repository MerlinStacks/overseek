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
import { automationEngine } from '../AutomationEngine';

export class MarketingScheduler {
    private static queue = QueueFactory.createQueue('scheduler');
    private static automationInterval: NodeJS.Timeout | null = null;
    private static abandonedCartInterval: NodeJS.Timeout | null = null;
    private static lifecycleInterval: NodeJS.Timeout | null = null;
    private static reportInterval: NodeJS.Timeout | null = null;

    /**
     * Register all marketing-related repeatable jobs
     */
    static async register() {
        // Remove the former hourly repeat rather than running two dispatchers.
        for (const job of await this.queue.getRepeatableJobs()) {
            if (job.name === 'refresh-ad-audiences') await this.queue.removeRepeatableByKey(job.key);
        }
        await this.queue.add('refresh-ad-audiences', {}, {
            repeat: { pattern: '*/5 * * * *' }, jobId: 'refresh-ad-audiences-5m'
        });
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

        // AI Manager Suggestions (daily at 8 AM UTC)
        await this.queue.add('ai-manager-suggestions', {}, {
            repeat: { pattern: '0 8 * * *' },
            jobId: 'ai-manager-suggestions-daily'
        });
        Logger.info('Scheduled AI Manager suggestion generation (Daily at 8 AM UTC)');
    }



    /**
     * Start all marketing-related tickers
     */
    static start() {
        // Defensive: avoid duplicate intervals if start() is called more than once.
        this.stop();

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

        // Run lifecycle automations at startup as well as every 6 hours. Waiting for
        // the first interval means this scan never runs in frequently restarted environments.
        const runLifecycleScan = () => this.checkLifecycleAutomations()
            .catch(e => Logger.error('Lifecycle Automation Check Error', { error: e }));
        void runLifecycleScan();
        this.lifecycleInterval = setInterval(
            runLifecycleScan,
            6 * 60 * 60 * 1000
        );

        // Report Scheduler (every 15 mins)
        this.reportInterval = setInterval(
            () => this.checkReportSchedules().catch(e => Logger.error('Report Scheduler Error', { error: e })),
            15 * 60 * 1000
        );
    }

    /**
     * Stop all marketing-related tickers.
     */
    static stop() {
        if (this.automationInterval) {
            clearInterval(this.automationInterval);
            this.automationInterval = null;
        }

        if (this.abandonedCartInterval) {
            clearInterval(this.abandonedCartInterval);
            this.abandonedCartInterval = null;
        }

        if (this.lifecycleInterval) {
            clearInterval(this.lifecycleInterval);
            this.lifecycleInterval = null;
        }

        if (this.reportInterval) {
            clearInterval(this.reportInterval);
            this.reportInterval = null;
        }
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
            },
            // Guard: cap at 100 per cycle to prevent loading a huge backlog into memory.
            // The next scheduler tick will process the remainder.
            take: 100
        });

        if (abandonedSessions.length > 0) {
            Logger.info(`[Scheduler] Found ${abandonedSessions.length} abandoned carts`);

            // Run automation triggers sequentially (side-effectful: sends emails)
            const notifiedSessionIds: string[] = [];
            for (const session of abandonedSessions) {
                const triggerResult = await automationEngine.processTrigger(session.accountId, 'ABANDONED_CART', {
                    email: session.email,
                    wooCustomerId: session.wooCustomerId,
                    cart: {
                        total: session.cartValue,
                        items: session.cartItems,
                        currency: session.currency,
                        checkoutUrl: session.currentPath
                    },
                    sessionId: session.id,
                    visitorId: session.visitorId
                });

                if (triggerResult.enrolled > 0) {
                    notifiedSessionIds.push(session.id);
                }
            }

            if (notifiedSessionIds.length > 0) {
                const sentAt = new Date();
                await prisma.analyticsSession.updateMany({
                    where: { id: { in: notifiedSessionIds } },
                    data: { abandonedNotificationSentAt: sentAt }
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

        // Enqueue all report jobs sequentially (BullMQ add is fast, no DB involved)
        for (const schedule of schedules) {
            await queue.add('generate-report', {
                accountId: schedule.accountId,
                scheduleId: schedule.id,
                runAt: (schedule.nextRunAt || schedule.createdAt).toISOString(),
            }, { jobId: `report-${schedule.id}-${(schedule.nextRunAt || schedule.createdAt).getTime()}` });
        }

        // Flush all nextRunAt updates in parallel.
        // Why Promise.all not updateMany: each schedule has a unique nextRunAt value.
        await Promise.all(
            schedules.map(schedule => {
                const nextRun = this.calculateNextRun(schedule);
                return prisma.reportSchedule.updateMany({
                    where: { id: schedule.id, accountId: schedule.accountId, nextRunAt: schedule.nextRunAt },
                    data: { nextRunAt: nextRun }
                });
            })
        );
    }

    static async checkLifecycleAutomations() {
        const automations = await prisma.marketingAutomation.findMany({
            where: {
                isActive: true,
                status: 'ACTIVE',
                triggerType: 'NO_PURCHASE_IN_X_DAYS'
            },
            select: {
                id: true,
                accountId: true,
                triggerConfig: true
            }
        });

        if (automations.length === 0) return;

        const automationsByAccount = new Map<string, typeof automations>();
        for (const automation of automations) {
            const existing = automationsByAccount.get(automation.accountId) || [];
            existing.push(automation);
            automationsByAccount.set(automation.accountId, existing);
        }

        for (const [accountId, accountAutomations] of automationsByAccount) {
            const purchaseOrders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    status: { in: ['processing', 'on-hold', 'completed'] }
                },
                select: {
                    wooCustomerId: true,
                    billingEmail: true,
                    dateCreated: true
                }
            });

            const latestByWooId = new Map<number, Date>();
            const latestByEmail = new Map<string, Date>();

            for (const order of purchaseOrders) {
                if (order.wooCustomerId) {
                    const existing = latestByWooId.get(order.wooCustomerId);
                    if (!existing || order.dateCreated > existing) {
                        latestByWooId.set(order.wooCustomerId, order.dateCreated);
                    }
                }

                if (order.billingEmail) {
                    const email = order.billingEmail.toLowerCase();
                    const existing = latestByEmail.get(email);
                    if (!existing || order.dateCreated > existing) {
                        latestByEmail.set(email, order.dateCreated);
                    }
                }
            }

            const customers = await prisma.wooCustomer.findMany({
                where: {
                    accountId,
                    email: { not: '' },
                    ordersCount: { gt: 0 }
                },
                select: {
                    wooId: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    ordersCount: true,
                    totalSpent: true
                }
            });

            for (const automation of accountAutomations) {
                const config = (automation.triggerConfig as Record<string, unknown> | null) || {};
                const daysWithoutPurchase = Number(config.daysWithoutPurchase || 90);
                const cutoff = new Date(Date.now() - daysWithoutPurchase * 24 * 60 * 60 * 1000);

                for (const customer of customers) {
                    const latestPurchase =
                        latestByWooId.get(customer.wooId)
                        || latestByEmail.get(customer.email.toLowerCase())
                        || null;

                    if (!latestPurchase || latestPurchase >= cutoff) {
                        continue;
                    }

                    await automationEngine.processTrigger(accountId, 'NO_PURCHASE_IN_X_DAYS', {
                        automationId: automation.id,
                        email: customer.email,
                        wooCustomerId: customer.wooId,
                        customer: {
                            email: customer.email,
                            firstName: customer.firstName,
                            lastName: customer.lastName,
                            ordersCount: customer.ordersCount,
                            totalSpent: Number(customer.totalSpent)
                        },
                        lastPurchaseAt: latestPurchase.toISOString(),
                        daysSinceLastPurchase: Math.floor((Date.now() - latestPurchase.getTime()) / (24 * 60 * 60 * 1000))
                    });
                }
            }
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
    // Prevents concurrent alert checks for the same account. Without this,
    // overlapping scheduler cycles pile up gRPC calls and inflate the heap.
    private static inFlightAlertAccounts = new Set<string>();
    // Prevents overlapping dispatch cycles from different trigger sources
    private static _adAlertsRunning = false;

    static async dispatchAdAlerts() {
        if (this._adAlertsRunning) {
            Logger.debug('[Scheduler] Skipping ad alert dispatch — already running');
            return;
        }
        this._adAlertsRunning = true;
        Logger.info('[Scheduler] Starting ad alert check');

        try {
            const { AdAlertService } = await import('../tools/AdAlertService');

            const accountsWithAds = await prisma.adAccount.findMany({
                select: { accountId: true },
                distinct: ['accountId']
            });

            Logger.info(`[Scheduler] Checking ad alerts for ${accountsWithAds.length} accounts`);

            for (const { accountId } of accountsWithAds) {
                // Skip accounts that are already being checked by a previous cycle
                if (this.inFlightAlertAccounts.has(accountId)) {
                    Logger.debug('[Scheduler] Skipping ad alert check — already in flight', { accountId });
                    continue;
                }

                this.inFlightAlertAccounts.add(accountId);
                try {
                    const detection = await AdAlertService.checkForAlerts(accountId);
                    await AdAlertService.persistAndDispatch(accountId, detection.alerts);
                    Logger.info('[Scheduler] Ad alert observations checked', { accountId, alerts: detection.alerts.length, coverage: detection.coverage });
                } catch (error) {
                    Logger.error(`[Scheduler] Ad alert check failed for account ${accountId}`, { error });
                } finally {
                    this.inFlightAlertAccounts.delete(accountId);
                }
            }
        } catch (error) {
            Logger.error('[Scheduler] Ad alerts dispatch failed', { error });
        } finally {
            this._adAlertsRunning = false;
        }
    }


    /**
     * Assess outcomes of implemented recommendations (AI Marketing Intelligence Phase 5)
     */
    static async dispatchOutcomeAssessment() {
        // Legacy rows do not carry comparable resource/window provenance. Never manufacture
        // outcomes from account ROAS or promote these associations into learned causal rules.
        Logger.info('[Scheduler] Automatic recommendation outcomes unavailable: comparable recorded observations required');
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

    static async dispatchAiManagerSuggestions() {
        // Refresh is explicitly user-admitted. Feature enablement alone is not actor authority.
        Logger.info('[Scheduler] AI Manager automatic refresh disabled; permissioned user refresh required');
    }
}
