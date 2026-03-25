import { useRelativeTime } from '../../hooks/useRelativeTime';

interface RelativeTimeProps {
    date: string | Date | undefined;
    className?: string;
    /** Update interval in ms (default: 60s) */
    interval?: number;
}

/**
 * Displays a live-updating relative timestamp (e.g., "5m ago", "2h ago").
 * Updates automatically on the given interval.
 */
export function RelativeTime({ date, className = 'text-xs text-gray-400', interval }: RelativeTimeProps) {
    const text = useRelativeTime(date, interval);
    if (!text) return null;
    return <span className={className}>{text}</span>;
}
