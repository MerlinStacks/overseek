import { useRelativeTime } from '../../hooks/useRelativeTime';
import { formatDateTimeSafe, toValidDate } from '../../utils/format';

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
    const parsed = toValidDate(date);
    const safeInterval = interval !== undefined && Number.isFinite(interval) && interval >= 1000 ? interval : 60000;
    const timestamp = parsed?.toISOString();
    const text = useRelativeTime(timestamp, safeInterval);
    if (!text) return null;
    return <time dateTime={timestamp} title={formatDateTimeSafe(date)} className={className}>{text}</time>;
}
