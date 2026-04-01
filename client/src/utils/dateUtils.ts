export type DateRangeOption = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'ytd' | 'all';
export type ComparisonOption = 'none' | 'previous_period' | 'previous_year' | 'smart';

export interface DateRange {
    startDate: string; // ISO Date string YYYY-MM-DD
    endDate: string;   // ISO Date string YYYY-MM-DD
}

export const getDateRange = (option: DateRangeOption | string): DateRange => {
    const end = new Date();
    const start = new Date();

    switch (option) {
        case 'today':
            // Start is today
            break;
        case 'yesterday':
            start.setDate(end.getDate() - 1);
            end.setDate(end.getDate() - 1);
            break;
        case '7d':
            start.setDate(end.getDate() - 7);
            break;
        case '30d':
            start.setDate(end.getDate() - 30);
            break;
        case '90d':
            start.setDate(end.getDate() - 90);
            break;
        case 'ytd':
            start.setMonth(0, 1); // Jan 1st of current year
            break;
        case 'all':
            start.setFullYear(2000, 0, 1); // Arbitrary old date
            break;
        default:
            // Custom or default to 30d
            start.setDate(end.getDate() - 30);
            break;
    }

    // Helper to get start/end of day in UTC, but respecting the LOCAL calendar day.
    // E.g. If local is Jan 10 (UTC+11), Start is Jan 9 13:00 UTC, End is Jan 10 12:59:59.999 UTC.

    // We construct a new Date object for the "Start" by setting time to 00:00:00 LOCAL
    const getStartOfDayUTC = (d: Date) => {
        const year = d.getFullYear();
        const month = d.getMonth();
        const day = d.getDate();
        // Create date at 00:00:00 local time
        const localStart = new Date(year, month, day, 0, 0, 0, 0);
        return localStart.toISOString();
    };

    const getEndOfDayUTC = (d: Date) => {
        const year = d.getFullYear();
        const month = d.getMonth();
        const day = d.getDate();
        // Create date at 23:59:59.999 local time
        const localEnd = new Date(year, month, day, 23, 59, 59, 999);
        return localEnd.toISOString();
    };

    return {
        startDate: getStartOfDayUTC(start),
        endDate: getEndOfDayUTC(end)
    };
};

/**
 * Resolve 'smart' comparison into a concrete strategy based on the range length.
 *   ≤2 days  → same weekday last week  (removes day-of-week noise)
 *   3–14 days → previous period         (week-over-week)
 *   >14 days  → same period last year   (YoY — the standard for monthly+)
 */
export function resolveSmartComparison(current: DateRange): { resolved: 'previous_week_same_day' | 'previous_period' | 'previous_year' | 'none' } {
    const start = new Date(current.startDate);
    const end = new Date(current.endDate);
    const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays <= 2)  return { resolved: 'previous_week_same_day' };
    if (diffDays <= 14) return { resolved: 'previous_period' };
    return { resolved: 'previous_year' };
}

export const getComparisonRange = (current: DateRange, type: ComparisonOption): DateRange | null => {
    if (type === 'none') return null;

    // Resolve 'smart' into a concrete type
    const effectiveType: string = type === 'smart' ? resolveSmartComparison(current).resolved : type;

    const start = new Date(current.startDate);
    const end = new Date(current.endDate);
    const duration = end.getTime() - start.getTime();

    const compStart = new Date(start);
    const compEnd = new Date(end);

    if (effectiveType === 'previous_year') {
        compStart.setFullYear(start.getFullYear() - 1);
        compEnd.setFullYear(end.getFullYear() - 1);
    } else if (effectiveType === 'previous_week_same_day') {
        // Shift back exactly 7 days — same weekday
        compStart.setDate(start.getDate() - 7);
        compEnd.setDate(end.getDate() - 7);
    } else if (effectiveType === 'previous_period') {
        compEnd.setTime(start.getTime() - (24 * 60 * 60 * 1000));
        compStart.setTime(compEnd.getTime() - duration);
    }

    return {
        startDate: compStart.toISOString().split('T')[0],
        endDate: compEnd.toISOString().split('T')[0]
    };
};

/**
 * Returns a human-readable label describing what the comparison is against.
 * e.g. "vs same day last week", "vs previous 7 days", "vs last year"
 */
export function getComparisonLabel(current: DateRange, type: ComparisonOption): string {
    if (type === 'none') return '';

    let effectiveType: string = type;
    if (type === 'smart') {
        effectiveType = resolveSmartComparison(current).resolved;
    }

    switch (effectiveType) {
        case 'previous_week_same_day': return 'vs same day last week';
        case 'previous_period': {
            const start = new Date(current.startDate);
            const end = new Date(current.endDate);
            const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays === 0) return 'vs previous day';
            if (diffDays === 7) return 'vs previous 7 days';
            return `vs previous ${diffDays} days`;
        }
        case 'previous_year': return 'vs last year';
        default: return 'vs last period';
    }
}

export const formatDateOption = (option: string): string => {
    switch (option) {
        case 'today': return 'Today';
        case 'yesterday': return 'Yesterday';
        case '7d': return 'Last 7 Days';
        case '30d': return 'Last 30 Days';
        case '90d': return 'Last 90 Days';
        case 'ytd': return 'Year to Date';
        case 'all': return 'All Time';
        default: return 'Custom';
    }
};
