/**
 * Shared date range utility for tracking metrics.
 * Uses timezone-aware boundaries for accurate "today" and "yesterday" calculations.
 */

/**
 * Calculate proper date range based on days parameter and timezone.
 * - days = 1: Today only (from midnight in user's timezone to now)
 * - days = -1: Yesterday only (full yesterday in user's timezone)
 * - days > 1: Last N days (simple offset from now)
 */
export function getDateRangeForDays(days: number, timezone: string = 'Australia/Sydney'): { startDate: Date; endDate: Date } {
    const now = new Date();

    const getDatePartsInTz = (date: Date, tz: string) => {
        const formatter = new Intl.DateTimeFormat('en-AU', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(date);
        const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0');
        return { year: get('year'), month: get('month') - 1, day: get('day') };
    };

    const getMidnightInTz = (year: number, month: number, day: number, tz: string): Date => {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`;
        const tempDate = new Date(dateStr + 'Z');
        const tzOffset = new Date(tempDate.toLocaleString('en-US', { timeZone: tz })).getTime() -
            new Date(tempDate.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
        return new Date(tempDate.getTime() - tzOffset);
    };

    if (days === 1) {
        const { year, month, day } = getDatePartsInTz(now, timezone);
        const startDate = getMidnightInTz(year, month, day, timezone);
        return { startDate, endDate: now };
    } else if (days === -1) {
        const { year, month, day } = getDatePartsInTz(now, timezone);
        const yesterdayDate = new Date(year, month, day - 1);
        const startDate = getMidnightInTz(yesterdayDate.getFullYear(), yesterdayDate.getMonth(), yesterdayDate.getDate(), timezone);
        const endDate = getMidnightInTz(year, month, day, timezone);
        endDate.setMilliseconds(endDate.getMilliseconds() - 1);
        return { startDate, endDate };
    } else {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return { startDate, endDate: now };
    }
}
