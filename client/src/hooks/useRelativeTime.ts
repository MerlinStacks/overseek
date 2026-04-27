import { useState, useEffect } from 'react';
import { formatTimeAgo } from '../utils/format';

/**
 * Returns a relative time string that auto-updates every `intervalMs`.
 * Use this instead of static formatTimeAgo() when the timestamp should stay fresh.
 */
export function useRelativeTime(date: string | Date | undefined, intervalMs = 60_000): string {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!date) return;
        const id = setInterval(() => setTick((t) => t + 1), intervalMs);
        return () => clearInterval(id);
    }, [date, intervalMs]);

    void tick;
    if (!date) return '';
    const normalizedDate = typeof date === 'string' ? new Date(date) : date;
    return formatTimeAgo(normalizedDate);
}
