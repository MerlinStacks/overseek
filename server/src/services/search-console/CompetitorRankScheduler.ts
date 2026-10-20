/**
 * Competitor Rank Scheduler
 *
 * Runs daily SERP position checks for all accounts with competitor domains.
 * Offset from the keyword rank scheduler by 2 hours to spread API load.
 *
 * Why separate scheduler: competitor checks use a different API
 * (Google Custom Search) with its own rate limits, and the data
 * updates independently from Search Console data.
 */

import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';
import { CompetitorAnalysisService } from './CompetitorAnalysisService';
import { SerpCheckService } from './SerpCheckService';

/** 24 hours in milliseconds */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 2 hours + 5 min after boot — offset from keyword scheduler to spread load */
const INITIAL_DELAY_MS = 2 * 60 * 60 * 1000 + 5 * 60 * 1000;

let timeout: ReturnType<typeof setTimeout> | null = null;
let started = false;
let generation = 0;
let inFlight: Promise<void> | null = null;

/**
 * Start the daily competitor rank refresh scheduler.
 * Safe to call multiple times; subsequent calls are no-ops.
 */
export function startCompetitorRankScheduler(): void {
    if (started) return;
    started = true;
    const current = ++generation;
    const tick = async () => {
        timeout = null;
        if (inFlight) await inFlight;
        if (!started || current !== generation) return;
        const work = runRefresh();
        inFlight = work;
        try { await work; } finally { if (inFlight === work) inFlight = null; }
        if (started && current === generation) timeout = setTimeout(() => void tick(), REFRESH_INTERVAL_MS);
    };
    timeout = setTimeout(() => void tick(), INITIAL_DELAY_MS);
}

/**
 * Stop the scheduler (for graceful shutdown).
 */
export async function stopCompetitorRankScheduler(): Promise<void> {
    started = false;
    generation++;
    if (timeout) clearTimeout(timeout);
    timeout = null;
    await inFlight;
}

/**
 * Run competitor SERP position refresh for all accounts.
 * Syncs keywords first, then checks positions.
 */
async function runRefresh(): Promise<void> {
    try {
        if (!await SerpCheckService.isConfigured()) return;
        Logger.info('Starting scheduled competitor rank refresh');

        // Find all accounts that have active competitor domains
        const accountIds = await prisma.competitorDomain.findMany({
            where: { isActive: true },
            select: { accountId: true },
            distinct: ['accountId']
        });

        Logger.info(`Refreshing competitor positions for ${accountIds.length} accounts`);

        for (const { accountId } of accountIds) {
            try {
                // Sync keywords first (pick up any new tracked keywords)
                await CompetitorAnalysisService.syncCompetitorKeywords(accountId);

                // Then check SERP positions
                const result = await CompetitorAnalysisService.refreshCompetitorPositions(accountId);
                Logger.info(`Competitor refresh for account complete`, {
                    accountId,
                    checked: result.checked,
                    movements: result.movements.length,
                });
            } catch (error) {
                Logger.error('Failed to refresh competitor positions for account', { accountId, error });
            }
        }

        Logger.info('Completed scheduled competitor rank refresh');
    } catch (error) {
        Logger.error('Scheduled competitor rank refresh failed', { error });
    }
}
