/**
 * AnomalyDetection Service
 *
 * Compares current-day revenue against a rolling 7-day baseline (same time window)
 * to detect significant deviations that warrant merchant attention.
 */

import { SalesAnalytics } from './sales';
import { Logger } from '../../utils/logger';

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
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);

            // Format dates for Elasticsearch queries
            const todayStartISO = todayStart.toISOString();
            const nowISO = now.toISOString();

            // Get today's revenue (from midnight to now)
            const todayData = await SalesAnalytics.getTotalSales(
                accountId,
                todayStartISO,
                nowISO
            );
            const todayRevenue = todayData.total || 0;

            // Calculate baseline: average of same time window for past 7 days
            const baselineRevenues: number[] = [];

            for (let i = 1; i <= 7; i++) {
                const pastDayStart = new Date(todayStart);
                pastDayStart.setDate(pastDayStart.getDate() - i);

                const pastDayEnd = new Date(now);
                pastDayEnd.setDate(pastDayEnd.getDate() - i);

                const pastData = await SalesAnalytics.getTotalSales(
                    accountId,
                    pastDayStart.toISOString(),
                    pastDayEnd.toISOString()
                );

                baselineRevenues.push(pastData.total || 0);
            }

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
            // Graceful degradation: return normal status on error
            return {
                isAnomaly: false,
                direction: 'normal',
                todayRevenue: 0,
                baselineRevenue: 0,
                percentChange: 0,
                message: ''
            };
        }
    }
}
