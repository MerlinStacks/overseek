/**
 * Keyword Rank Scheduler
 *
 * Runs daily position refreshes for all accounts with tracked keywords.
 * Uses setInterval because there's no existing cron infrastructure.
 *
 * Why 24h interval: Search Console data updates once daily,
 * so more frequent polling wastes quota.
 */

import { Logger } from '../../utils/logger';
import { KeywordTrackingService } from './KeywordTrackingService';

/** 24 hours in milliseconds */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 5 minutes delay before first run (let server finish booting) */
const INITIAL_DELAY_MS = 5 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let initialTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

/**
 * Start the daily keyword rank refresh scheduler.
 * Safe to call multiple times; subsequent calls are no-ops.
 */
export function startKeywordRankScheduler(): void {
    if (intervalHandle || initialTimeoutHandle) {
        Logger.info('Keyword rank scheduler already running');
        return;
    }

    Logger.info('Keyword rank scheduler starting', {
        intervalMs: REFRESH_INTERVAL_MS,
        initialDelayMs: INITIAL_DELAY_MS,
    });

    // First run after boot delay
    initialTimeoutHandle = setTimeout(async () => {
        initialTimeoutHandle = null;
        await runRefresh();

        // Then every 24 hours
        intervalHandle = setInterval(runRefresh, REFRESH_INTERVAL_MS);
    }, INITIAL_DELAY_MS);
}

/**
 * Stop the scheduler (for graceful shutdown).
 */
export function stopKeywordRankScheduler(): void {
    if (initialTimeoutHandle) {
        clearTimeout(initialTimeoutHandle);
        initialTimeoutHandle = null;
    }
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
    Logger.info('Keyword rank scheduler stopped');
}

async function runRefresh(): Promise<void> {
    try {
        Logger.info('Starting scheduled keyword rank refresh');
        await KeywordTrackingService.refreshAllAccounts();
        Logger.info('Completed scheduled keyword rank refresh');
    } catch (error) {
        Logger.error('Scheduled keyword rank refresh failed', { error });
    }
}
