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
export function getDateRangeForDays(days: number, timezone: string = 'Australia/Sydney', now: Date = new Date()): { startDate: Date; endDate: Date } {

    const getDatePartsInTz = (date: Date, tz: string) => {
        const formatter = new Intl.DateTimeFormat('en-AU', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        });
        const parts = formatter.formatToParts(date);
        const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0');
        return { year: get('year'), month: get('month') - 1, day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
    };

    const getMidnightInTz = (year: number, month: number, day: number, tz: string): Date => {
        const midnight = Date.UTC(year, month, day);
        let candidate = midnight;
        // Re-evaluate the offset at local midnight, which can differ from
        // the offset at UTC midnight on a daylight-saving transition day.
        for (let i = 0; i < 3; i++) {
            const parts = getDatePartsInTz(new Date(candidate), tz);
            const localTime = Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
            const adjustment = midnight - localTime;
            candidate += adjustment;
            if (adjustment === 0) break;
        }
        return new Date(candidate);
    };

    if (days === 1) {
        const { year, month, day } = getDatePartsInTz(now, timezone);
        const startDate = getMidnightInTz(year, month, day, timezone);
        return { startDate, endDate: now };
    } else if (days === -1) {
        const { year, month, day } = getDatePartsInTz(now, timezone);
        const yesterdayDate = new Date(Date.UTC(year, month, day - 1));
        const startDate = getMidnightInTz(yesterdayDate.getUTCFullYear(), yesterdayDate.getUTCMonth(), yesterdayDate.getUTCDate(), timezone);
        const endDate = getMidnightInTz(year, month, day, timezone);
        endDate.setMilliseconds(endDate.getMilliseconds() - 1);
        return { startDate, endDate };
    } else {
        const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        return { startDate, endDate: now };
    }
}
