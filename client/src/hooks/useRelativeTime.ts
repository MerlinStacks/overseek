import { useState, useEffect, useMemo } from 'react';
import { formatTimeAgo } from '../utils/format';

/**
 * Returns a relative time string that auto-updates every `intervalMs`.
 * Use this instead of static formatTimeAgo() when the timestamp should stay fresh.
 */
export function useRelativeTime(date: string | Date | undefined, intervalMs = 60_000): string {
    // Stabilize to a primitive so Date objects don't cause infinite re-runs
    const dateMs = useMemo(() => {
        if (!date) return 0;
        return typeof date === 'string' ? new Date(date).getTime() : date.getTime();
    }, [date instanceof Date ? date.getTime() : date]);

    const [text, setText] = useState(() => dateMs ? formatTimeAgo(new Date(dateMs)) : '');

    useEffect(() => {
        if (!dateMs) { setText(''); return; }

        const d = new Date(dateMs);
        setText(formatTimeAgo(d));
        const id = setInterval(() => setText(formatTimeAgo(d)), intervalMs);
        return () => clearInterval(id);
    }, [dateMs, intervalMs]);

    return text;
}
