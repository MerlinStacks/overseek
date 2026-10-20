/**
 * AnomalyDetection Service
 *
 * Compares current-day revenue against a rolling 7-day baseline (same time window)
 * to detect significant deviations that warrant merchant attention.
 */

import { SalesAnalytics } from './sales';
import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';
import { dateKeyInTimezone, normalizeTimezone, sameTimeOnDateInTimezone, startOfDateInTimezone } from '../../utils/timezone';

/** Anomaly detection result structure */
export interface AnomalyResult {
    isAnomaly: boolean;
    direction: 'above' | 'below' | 'normal';
    todayRevenue: number;
    baselineRevenue: number;
    percentChange: number;
    message: string;
}

/** Threshold for flagging anomalies (25% deviation) */
const ANOMALY_THRESHOLD = 25;

export class AnomalyDetection {
    /**
     * Get Revenue Anomaly Status
     *
     * Calculates whether today's revenue (up to current hour) is significantly
     * different from the average of the same time window over the past 7 days.
     */
    static async getRevenueAnomaly(accountId: string): Promise<AnomalyResult> {
        try {
            const now = new Date();
            const account = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } });
            if (!account) throw new Error('Account not found');
            const timezone = normalizeTimezone(account.timezone);
            const today = dateKeyInTimezone(now, timezone);
            const revenues: number[] = [];

            // Two windows at a time bounds database fan-out while avoiding eight sequential calls.
            for (let offset = 0; offset < 8; offset += 2) {
                const values = await Promise.all([offset, offset + 1].map(async daysAgo => {
                    const date = new Date(`${today}T00:00:00.000Z`);
                    date.setUTCDate(date.getUTCDate() - daysAgo);
                    const day = date.toISOString().slice(0, 10);
                    const start = startOfDateInTimezone(day, timezone);
                    const end = daysAgo === 0 ? now : sameTimeOnDateInTimezone(now, day, timezone);
                    const data = await SalesAnalytics.getTotalSales(accountId, start.toISOString(), end.toISOString(), { throwOnError: true });
                    if (!Number.isFinite(data.total)) throw new Error('Invalid revenue data');
                    return data.total;
                }));
                revenues.push(...values);
            }
            const [todayRevenue, ...baselineRevenues] = revenues;

            // Calculate average baseline
            const totalBaseline = baselineRevenues.reduce((sum, val) => sum + val, 0);
            const baselineRevenue = baselineRevenues.length > 0
                ? totalBaseline / baselineRevenues.length
                : 0;

            // Handle edge case: no baseline data (new account or no historical orders)
            if (baselineRevenue === 0) {
                return {
                    isAnomaly: false,
                    direction: 'normal',
                    todayRevenue,
                    baselineRevenue: 0,
                    percentChange: 0,
                    message: ''
                };
            }

            // Calculate percent change
            const percentChange = ((todayRevenue - baselineRevenue) / baselineRevenue) * 100;
            const absChange = Math.abs(percentChange);

            // Determine anomaly status
            let direction: 'above' | 'below' | 'normal' = 'normal';
            let isAnomaly = false;
            let message = '';

            if (absChange >= ANOMALY_THRESHOLD) {
                isAnomaly = true;
                if (percentChange > 0) {
                    direction = 'above';
                    message = `Revenue is ${Math.round(absChange)}% above normal! 🚀`;
                } else {
                    direction = 'below';
                    message = `Revenue is ${Math.round(absChange)}% below expected`;
                }
            }

            return {
                isAnomaly,
                direction,
                todayRevenue,
                baselineRevenue,
                percentChange: Math.round(percentChange),
                message
            };
        } catch (error) {
            Logger.error('AnomalyDetection Error', { error, accountId });
            // Callers already have an unavailable/error path; never label a failed query normal.
            throw error;
        }
    }
}
