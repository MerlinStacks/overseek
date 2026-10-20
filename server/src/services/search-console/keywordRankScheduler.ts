import { Logger } from '../../utils/logger';
import { KeywordTrackingService } from './KeywordTrackingService';

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 5 * 60 * 1000;
let timeout: ReturnType<typeof setTimeout> | null = null;
let started = false;
let generation = 0;
let inFlight: Promise<void> | null = null;

/** Schedule the next refresh only after the previous one finishes. */
export function startKeywordRankScheduler(): void {
    if (started) return;
    started = true;
    const current = ++generation;
    const tick = async () => {
        timeout = null;
        // A previous generation can still be draining after a stop/restart.
        if (inFlight) await inFlight;
        if (!started || current !== generation) return;
        const work = runRefresh();
        inFlight = work;
        try { await work; } finally { if (inFlight === work) inFlight = null; }
        if (started && current === generation) timeout = setTimeout(() => void tick(), REFRESH_INTERVAL_MS);
    };
    timeout = setTimeout(() => void tick(), INITIAL_DELAY_MS);
}

export async function stopKeywordRankScheduler(): Promise<void> {
    started = false;
    generation++;
    if (timeout) clearTimeout(timeout);
    timeout = null;
    await inFlight;
}

async function runRefresh(): Promise<void> {
    try {
        await KeywordTrackingService.refreshAllAccounts();
        Logger.info('Completed scheduled keyword rank refresh');
    } catch (error) {
        Logger.error('Scheduled keyword rank refresh failed', { error });
    }
}
