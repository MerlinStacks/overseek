export type DateRangeOption = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'ytd' | 'all';
export type ComparisonOption = 'none' | 'previous_period' | 'previous_year';

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

export const getComparisonRange = (current: DateRange, type: ComparisonOption): DateRange | null => {
    if (type === 'none') return null;

    const start = new Date(current.startDate);
    const end = new Date(current.endDate);

    // Calculate duration in milliseconds
    const duration = end.getTime() - start.getTime();

    const compStart = new Date(start);
    const compEnd = new Date(end);

    if (type === 'previous_year') {
        compStart.setFullYear(start.getFullYear() - 1);
        compEnd.setFullYear(end.getFullYear() - 1);
    } else if (type === 'previous_period') {
        // Subtract duration
        // We add 1 day to duration usually because inclusive dates? 
        // e.g. Jan 1 to Jan 7 is 7 days.
        // Jan 1ms - Jan 7ms diff is 6 days * 24h. 
        // Let's rely on simple date subtraction for now.
        // If range is Today (Jan 1), duration is 0. Previous is Jan 0 (Dec 31).

        // Better approach: subtract (duration + 1 day) from start and end?
        // Let's just subtract the difference.
        const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        // If diff is 0 (today to today), we subtract 1 day.
        const daysToShift = diffDays === 0 ? 1 : diffDays;

        compEnd.setDate(compEnd.getDate() - daysToShift); // End of prev period is roughly start of current
        // Actually, typically prev period ends the day before current start.
        compEnd.setTime(start.getTime() - (24 * 60 * 60 * 1000));

        compStart.setTime(compEnd.getTime() - duration);
    }

    return {
        startDate: compStart.toISOString().split('T')[0],
        endDate: compEnd.toISOString().split('T')[0]
    };
};

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
