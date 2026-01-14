import { QueueFactory, QUEUES } from './queue/QueueFactory';
import { Logger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

import { AutomationEngine } from './AutomationEngine';
import { JanitorService } from './JanitorService';
const automationEngine = new AutomationEngine();

export class SchedulerService {

    // Start all scheduled tasks
    static async start() {
        Logger.info('Starting Scheduler Service...');


        await this.scheduleSyncAll();

        // Start Tickers (Legacy setIntervals, moving to workers later?)
        // For now, run them here to keep index.ts clean.
        this.startTickers();
    }

    private static startTickers() {
        Logger.info('Starting Automation Tickers...');

        // Review Automation


        // Marketing Automation
        setInterval(() => {
            automationEngine.runTicker().catch(e => Logger.error('Marketing Ticker Error', { error: e }));
        }, 60 * 1000); // 1 Min

        // Email Polling (Check every 2 minutes)
        setInterval(async () => {
            try {
                const accounts = await prisma.emailAccount.findMany({ where: { type: 'IMAP' } });
                Logger.info(`[Email Polling] Starting check - found ${accounts.length} IMAP account(s)`);

                if (accounts.length > 0) {
                    const { EmailService } = await import('./EmailService');
                    const emailService = new EmailService();
                    for (const acc of accounts) {
                        try {
                            await emailService.checkEmails(acc.id);
                            Logger.info(`[Email Polling] Checked account: ${acc.email}`);
                        } catch (accError) {
                            Logger.error(`[Email Polling] Failed to check account: ${acc.email}`, { error: accError });
                        }
                    }
                }
            } catch (error) {
                Logger.error('Email Polling Error', { error });
            }
        }, 2 * 60 * 1000);


        // Report Scheduler (Check every 15 minutes)
        setInterval(() => {
            SchedulerService.checkReportSchedules().catch(e => Logger.error('Report Scheduler Error', { error: e }));
        }, 15 * 60 * 1000);

        // Inventory Health Check (Daily at 8 AM Check - simplified ticker for now runs hourly)
        // Ideally handled by a proper cron job, but we'll check every hour and run if it's 8 AM local time?
        setInterval(() => {
            // We can check if it's roughly 8 AM UTC? Or just run it.
            // Better: Use the Orchestrator pattern.
        }, 60 * 60 * 1000);

        // Abandoned Cart Check (Every 15 mins)
        setInterval(() => {
            SchedulerService.checkAbandonedCarts().catch(e => Logger.error('Abandoned Cart Check Error', { error: e }));
        }, 15 * 60 * 1000);

        // The Janitor - Daily Cleanup (Run once per day at startup + 24h interval)
        JanitorService.runCleanup().catch(e => Logger.error('Janitor Error', { error: e }));
        setInterval(() => {
            JanitorService.runCleanup().catch(e => Logger.error('Janitor Error', { error: e }));
        }, 24 * 60 * 60 * 1000);

        // Scheduled Messages Worker (Check every minute)
        setInterval(() => {
            SchedulerService.processScheduledMessages().catch(e => Logger.error('Scheduled Message Error', { error: e }));
        }, 60 * 1000);

        // Snooze Reminder Worker (Check every minute)
        setInterval(() => {
            SchedulerService.checkSnoozedConversations().catch(e => Logger.error('Snooze Check Error', { error: e }));
        }, 60 * 1000);

    }

    private static async checkAbandonedCarts() {
        // 1 hour ago
        const cutOffTime = new Date(Date.now() - 60 * 60 * 1000);
        // 24 hours ago (don't send for ancient carts)
        const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const abandonedSessions = await prisma.analyticsSession.findMany({
            where: {
                cartValue: { gt: new Prisma.Decimal(0) },
                lastActiveAt: {
                    lt: cutOffTime,
                    gt: windowStart
                },
                email: { not: null }, // Must have email
                abandonedNotificationSentAt: null // Not sent yet
            }
        });

        if (abandonedSessions.length > 0) {
            Logger.info(`[Scheduler] Found ${abandonedSessions.length} abandoned carts`);

            for (const session of abandonedSessions) {
                // Trigger Automation
                await automationEngine.processTrigger(session.accountId, 'ABANDONED_CART', {
                    email: session.email,
                    wooCustomerId: session.wooCustomerId,
                    cart: {
                        total: session.cartValue,
                        items: session.cartItems,
                        currency: session.currency,
                        checkoutUrl: session.currentPath // Or construct recovery URL
                    },
                    visitorId: session.visitorId
                });

                // Mark as sent
                await prisma.analyticsSession.update({
                    where: { id: session.id },
                    data: { abandonedNotificationSentAt: new Date() }
                });
            }
        }
    }

    private static async checkReportSchedules() {
        const now = new Date();
        // Find schedules due
        // Logic: active, and (nextRunAt <= now OR (lastRunAt is null/old))
        // Simplification: We rely on nextRunAt being set correctly when created/updated.
        // Initially, nextRunAt might be set to the upcoming slot.
        const schedules = await prisma.reportSchedule.findMany({
            where: {
                isActive: true,
                OR: [
                    { nextRunAt: { lte: now } },
                    { nextRunAt: null } // Should ideally be set on creation, but fallback
                ]
            }
        });

        if (schedules.length === 0) return;

        Logger.info(`[Scheduler] Found ${schedules.length} reports to run`);

        const queue = QueueFactory.getQueue(QUEUES.REPORTS);

        for (const schedule of schedules) {
            // Dispatch Job
            await queue.add('generate-report', {
                accountId: schedule.accountId,
                scheduleId: schedule.id
            });

            // Calculate Next Run
            const nextRun = this.calculateNextRun(schedule);
            await prisma.reportSchedule.update({
                where: { id: schedule.id },
                data: { nextRunAt: nextRun }
            });
        }
    }

    private static calculateNextRun(schedule: any): Date {
        const now = new Date();
        const [hour, checkMinute] = (schedule.time || '09:00').split(':').map(Number);

        let next = new Date();
        next.setHours(hour, checkMinute || 0, 0, 0);

        // If today's time passed, move to tomorrow as base
        if (next <= now) {
            next.setDate(next.getDate() + 1);
        }

        if (schedule.frequency === 'WEEKLY') {
            // desired day: 1-7 (Mon-Sun)
            // current day: 1-7 (Mon-Sun). JS getDay() is 0 (Sun) - 6 (Sat)
            const currentDayJS = next.getDay();
            const currentDayISO = currentDayJS === 0 ? 7 : currentDayJS; // 1-7

            const desiredDay = schedule.dayOfWeek || 1;

            let daysToAdd = desiredDay - currentDayISO;
            if (daysToAdd < 0) daysToAdd += 7;

            next.setDate(next.getDate() + daysToAdd);

        } else if (schedule.frequency === 'MONTHLY') {
            // desired day: 1-28
            const desiredDay = schedule.dayOfMonth || 1;

            // Move to day
            next.setDate(desiredDay);

            // If we went back in time (e.g. today is 15th, next is 1st of this month), add month
            if (next <= now) {
                next.setMonth(next.getMonth() + 1);
            }
        }

        return next;
    }

    private static async scheduleSyncAll() {
        // We want to sync ALL accounts every X minutes?
        // Or better: Iterate all accounts and queue them?
        // BullMQ repeatable job usually adds ONE job that repeats.
        // If we want to sync all accounts, we need a "Master Job" that finds accounts and spawns child jobs.

        const queue = QueueFactory.createQueue('scheduler'); // Dedicated queue

        /*
            Master Job: "Sync Orchestrator"
            Runs every 15 minutes.
            Fetches all accounts and dispatches 'runSync' for each.
        */

        await queue.add('orchestrate-sync', {}, {
            repeat: {
                pattern: '*/5 * * * *', // Every 5 mins - faster sync for near real-time order visibility
            },
            jobId: 'orchestrator' // Singleton
        });

        QueueFactory.createWorker('scheduler', async (job) => {
            if (job.name === 'orchestrate-sync') {
                await this.dispatchToAllAccounts();
            }
        });

        Logger.info('Scheduled Global Sync Orchestrator (Every 5 mins)');

        // Schedule Inventory Alerts (Daily at 08:00 UTC)
        await queue.add('inventory-alerts', {}, {
            repeat: {
                pattern: '0 8 * * *', // Daily at 8 AM
            },
            jobId: 'inventory-alerts-daily'
        });

        // Schedule Gold Price Updates (Daily at 06:00 UTC)
        await queue.add('gold-price-update', {}, {
            repeat: {
                pattern: '0 6 * * *', // Daily at 6 AM UTC
            },
            jobId: 'gold-price-update-daily'
        });

        Logger.info('Scheduled Gold Price Update (Daily at 6 AM UTC)');

        QueueFactory.createWorker('scheduler', async (job) => {
            if (job.name === 'orchestrate-sync') {
                await this.dispatchToAllAccounts();
            } else if (job.name === 'inventory-alerts') {
                await this.dispatchInventoryAlerts();
            } else if (job.name === 'gold-price-update') {
                await this.dispatchGoldPriceUpdates();
            }
        });

    }

    private static async dispatchToAllAccounts() {
        const accounts = await prisma.account.findMany({ select: { id: true } });
        Logger.info(`Orchestrator: Dispatching sync for ${accounts.length} accounts`);

        // We import SyncService here to avoid circular dep issues at top level if any, 
        // but facade is clean.
        const { SyncService } = await import('./sync');
        const service = new SyncService();

        for (const acc of accounts) {
            // Use SyncService with Low Priority (1)
            // This ensures we use the same Job ID Logic (sync_orders_ACCID) and Duplicate Prevention.
            // If a Manual Sync (Prio 10) is active, this request will be skipped by SyncService.
            // If no job active, this will start with Prio 1.
            await service.runSync(acc.id, {
                incremental: true,
                priority: 1
            });
        }
    }

    private static async dispatchInventoryAlerts() {
        const accounts = await prisma.account.findMany({ select: { id: true } });
        const { InventoryService } = await import('./InventoryService');
        const { InventoryForecastService } = await import('./analytics/InventoryForecastService');
        const { EventBus, EVENTS } = await import('./events');

        Logger.info(`[Scheduler] Dispatching Inventory Alerts for ${accounts.length} accounts`);

        for (const acc of accounts) {
            try {
                // Legacy: Basic velocity-based alerts
                await InventoryService.sendLowStockAlerts(acc.id);

                // New: Predictive forecast-based alerts
                const alerts = await InventoryForecastService.getStockoutAlerts(acc.id, 14);

                if (alerts.critical.length > 0) {
                    // Emit event for NotificationEngine to handle
                    EventBus.emit(EVENTS.INVENTORY.STOCKOUT_ALERT, {
                        accountId: acc.id,
                        products: alerts.critical.map(p => ({
                            id: p.id,
                            name: p.name,
                            sku: p.sku,
                            currentStock: p.currentStock,
                            daysUntilStockout: p.daysUntilStockout,
                            stockoutRisk: p.stockoutRisk,
                            recommendedReorderQty: p.recommendedReorderQty
                        }))
                    });
                    Logger.info(`[Scheduler] Emitted stockout alert for ${alerts.critical.length} products`, { accountId: acc.id });
                }
            } catch (error) {
                Logger.error(`[Scheduler] Inventory alerts failed for account ${acc.id}`, { error });
            }
        }
    }

    /**
     * Updates gold prices for all accounts with GOLD_PRICE_CALCULATOR feature enabled
     */
    private static async dispatchGoldPriceUpdates() {
        const { GoldPriceService } = await import('./GoldPriceService');

        // Find accounts with GOLD_PRICE_CALCULATOR feature enabled
        const enabledAccounts = await prisma.accountFeature.findMany({
            where: {
                featureKey: 'GOLD_PRICE_CALCULATOR',
                isEnabled: true
            },
            select: { accountId: true }
        });

        Logger.info(`[Scheduler] Updating gold prices for ${enabledAccounts.length} accounts`);

        for (const { accountId } of enabledAccounts) {
            try {
                await GoldPriceService.updateAccountPrice(accountId);
                Logger.info(`[Scheduler] Updated gold price for account ${accountId}`);
            } catch (error) {
                Logger.error(`[Scheduler] Failed to update gold price for account ${accountId}`, { error });
            }
        }
    }

    /**
     * Process scheduled messages that are due to be sent.
     * Finds messages where scheduledFor <= now and sends them.
     */
    private static async processScheduledMessages() {
        const now = new Date();

        // Find due scheduled messages
        const dueMessages = await prisma.message.findMany({
            where: {
                scheduledFor: {
                    lte: now,
                    not: null,
                },
            },
            include: {
                conversation: {
                    include: {
                        account: true,
                        wooCustomer: true,
                    },
                },
            },
            take: 50, // Process in batches
        });

        if (dueMessages.length === 0) return;

        Logger.info(`[Scheduler] Processing ${dueMessages.length} scheduled message(s)`);

        for (const message of dueMessages) {
            try {
                // For email conversations, actually send the email
                if (message.conversation.channel === 'EMAIL') {
                    const { EmailService } = await import('./EmailService');
                    const emailService = new EmailService();

                    // Get recipient email
                    const recipientEmail = message.conversation.wooCustomer?.email
                        || message.conversation.guestEmail;

                    if (recipientEmail) {
                        // Find default email account for this account
                        const { getDefaultEmailAccount } = await import('../utils/getDefaultEmailAccount');
                        const emailAccount = await getDefaultEmailAccount(message.conversation.accountId);

                        if (emailAccount) {
                            await emailService.sendEmail(
                                message.conversation.accountId,
                                emailAccount.id,
                                recipientEmail,
                                `Re: Conversation`,
                                message.content
                            );
                        }
                    }
                }

                // Clear the scheduled time (marks as sent)
                await prisma.message.update({
                    where: { id: message.id },
                    data: { scheduledFor: null },
                });

                Logger.info(`[Scheduler] Sent scheduled message ${message.id}`);
            } catch (error) {
                Logger.error(`[Scheduler] Failed to send scheduled message ${message.id}`, { error });
            }
        }
    }

    /**
     * Check for snoozed conversations that should be reopened.
     * Emits socket events to notify assigned agents.
     */
    private static async checkSnoozedConversations() {
        const now = new Date();

        // Find snoozed conversations where snooze has expired
        const expiredSnoozes = await prisma.conversation.findMany({
            where: {
                status: 'SNOOZED',
                snoozedUntil: {
                    lte: now,
                    not: null,
                },
            },
            include: {
                assignee: true,
                wooCustomer: true,
            },
            take: 50,
        });

        if (expiredSnoozes.length === 0) return;

        Logger.info(`[Scheduler] Reopening ${expiredSnoozes.length} snoozed conversation(s)`);

        // Dynamically import to avoid circular deps
        const { getIO } = await import('../socket');
        const io = getIO();

        for (const conversation of expiredSnoozes) {
            try {
                // Reopen the conversation
                await prisma.conversation.update({
                    where: { id: conversation.id },
                    data: {
                        status: 'OPEN',
                        snoozedUntil: null,
                    },
                });

                // Emit socket event to notify about snooze expiry
                if (io) {
                    const customerName = conversation.wooCustomer
                        ? `${conversation.wooCustomer.firstName || ''} ${conversation.wooCustomer.lastName || ''}`.trim()
                        : conversation.guestName || conversation.guestEmail || 'Unknown';

                    const snoozeEventData = {
                        conversationId: conversation.id,
                        assignedToId: conversation.assignedTo,
                        customerName,
                    };

                    // Emit to account room so all agents on this account receive it
                    io.to(`account:${conversation.accountId}`).emit('snooze:expired', snoozeEventData);

                    // Also emit conversation update to the conversation room
                    io.to(`conversation:${conversation.id}`).emit('conversation:updated', {
                        id: conversation.id,
                        status: 'OPEN',
                        snoozedUntil: null,
                    });
                }

                Logger.info(`[Scheduler] Reopened snoozed conversation ${conversation.id}`);
            } catch (error) {
                Logger.error(`[Scheduler] Failed to reopen conversation ${conversation.id}`, { error });
            }
        }
    }
}
