import { dateKeyInTimezone, normalizeTimezone, sameTimeOnDateInTimezone, startOfDateInTimezone } from '../../utils/timezone';
import { shiftDate } from './toolData';

export const REVENUE_PERIODS = ['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month'] as const;
export function validRevenuePeriod(period: unknown): period is typeof REVENUE_PERIODS[number] {
    return typeof period === 'string' && REVENUE_PERIODS.some(value => value === period);
}

/** All ends are exclusive; incomplete days/months compare to the matching local clock time. */
export function revenuePeriods(period: string, timezone: string, now = new Date()) {
    if (!validRevenuePeriod(period)) throw new Error('Unsupported revenue period');
    const zone = normalizeTimezone(timezone);
    const today = dateKeyInTimezone(now, zone);
    const midnight = startOfDateInTimezone(today, zone);
    if (period === 'yesterday') {
        const start = startOfDateInTimezone(shiftDate(today, -1), zone);
        return { start, end: midnight, prevStart: startOfDateInTimezone(shiftDate(today, -2), zone), prevEnd: start };
    }
    if (period === 'today') return {
        start: midnight, end: now,
        prevStart: startOfDateInTimezone(shiftDate(today, -1), zone),
        prevEnd: sameTimeOnDateInTimezone(now, shiftDate(today, -1), zone),
    };
    if (period === 'this_month') {
        const [year, month, day] = today.split('-').map(Number);
        const previousMonth = new Date(Date.UTC(year, month - 2, 1));
        const prefix = previousMonth.toISOString().slice(0, 7);
        const lastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
        return {
            start: startOfDateInTimezone(`${today.slice(0, 7)}-01`, zone), end: now,
            prevStart: startOfDateInTimezone(`${prefix}-01`, zone),
            prevEnd: sameTimeOnDateInTimezone(now, `${prefix}-${String(Math.min(day, lastDay)).padStart(2, '0')}`, zone),
        };
    }
    const days = period === 'last_7_days' ? 7 : 30;
    const start = sameTimeOnDateInTimezone(now, shiftDate(today, -days), zone);
    return { start, end: now, prevStart: sameTimeOnDateInTimezone(now, shiftDate(today, -2 * days), zone), prevEnd: start };
}
