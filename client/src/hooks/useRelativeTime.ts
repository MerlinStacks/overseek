import { useState, useEffect } from 'react';
import { formatTimeAgo, toValidDate } from '../utils/format';

/**
 * Returns a relative time string that auto-updates every `intervalMs`.
 * Use this instead of static formatTimeAgo() when the timestamp should stay fresh.
 */
export function useRelativeTime(date: string | Date | undefined, intervalMs = 60_000): string {
    const [tick, setTick] = useState(0);
    const timestamp = toValidDate(date)?.getTime();
    const delay = Number.isFinite(intervalMs) ? Math.min(2147483647, Math.max(1000, intervalMs)) : 60000;

    useEffect(() => {
        if (timestamp === undefined) return;
        const id = setInterval(() => setTick((t) => t + 1), delay);
        return () => clearInterval(id);
    }, [timestamp, delay]);

    void tick;
    return timestamp === undefined ? '' : formatTimeAgo(new Date(timestamp));
}
