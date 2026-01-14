/**
 * Ad Alert Service
 * 
 * Proactive monitoring and alerting for ad performance issues.
 * Integrates with NotificationEngine for push notifications.
 * 
 * Part of AI Marketing Co-Pilot Phase 6.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { EventBus, EVENTS } from '../events';
import { AdsService } from '../ads';
import { MultiPeriodAnalyzer } from './analyzers';

// =============================================================================
// TYPES
// =============================================================================

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface AdAlert {
    id: string;
    severity: AlertSeverity;
    type: string;
    title: string;
    message: string;
    platform?: 'google' | 'meta';
    campaignId?: string;
    campaignName?: string;
    data: Record<string, unknown>;
}

export interface AlertThresholds {
    roasCrashPercent: number;      // % drop to trigger crash alert (default: 30)
    budgetDepletionPercent: number; // % spent to trigger depletion warning (default: 80)
    conversionZeroDays: number;    // Days with 0 conversions to alert (default: 3)
    ctrDropPercent: number;        // % CTR drop to alert (default: 40)
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
    roasCrashPercent: 30,
    budgetDepletionPercent: 80,
    conversionZeroDays: 3,
    ctrDropPercent: 40
};

// =============================================================================
// MAIN SERVICE
// =============================================================================

export class AdAlertService {

    /**
     * Run a full alert check for an account.
     * Call this periodically (e.g., hourly for critical, daily for info).
     */
    static async checkForAlerts(
        accountId: string,
        thresholds: Partial<AlertThresholds> = {}
    ): Promise<AdAlert[]> {
        const config = { ...DEFAULT_THRESHOLDS, ...thresholds };
        const alerts: AdAlert[] = [];

        try {
            // Get multi-period analysis for trend detection
            const multiPeriod = await MultiPeriodAnalyzer.analyze(accountId);

            // Get ad accounts
            const adAccounts = await prisma.adAccount.findMany({
                where: { accountId },
                select: { id: true, platform: true, name: true }
            });

            // Check each platform
            for (const adAccount of adAccounts) {
                const platform = adAccount.platform.toLowerCase() as 'google' | 'meta';

                try {
                    // Get campaign data
                    const campaigns = platform === 'google'
                        ? await AdsService.getGoogleCampaignInsights(adAccount.id, 7)
                        : await AdsService.getMetaCampaignInsights(adAccount.id, 7);

                    for (const campaign of campaigns) {
                        // ROAS Crash Detection
                        const roasAlert = await this.checkRoasCrash(
                            accountId, adAccount.id, campaign, config.roasCrashPercent
                        );
                        if (roasAlert) alerts.push(roasAlert);

                        // Zero Conversions Alert
                        if (campaign.conversions === 0 && campaign.spend > 100) {
                            alerts.push({
                                id: `zero_conv_${campaign.campaignId}`,
                                severity: 'warning',
                                type: 'zero_conversions',
                                title: 'No Conversions',
                                message: `${campaign.campaignName} has spent $${campaign.spend.toFixed(0)} with no conversions in 7 days`,
                                platform,
                                campaignId: campaign.campaignId,
                                campaignName: campaign.campaignName,
                                data: { spend: campaign.spend, days: 7 }
                            });
                        }

                        // CTR Crash Detection
                        if (campaign.ctr < 0.3 && campaign.impressions > 10000) {
                            alerts.push({
                                id: `low_ctr_${campaign.campaignId}`,
                                severity: 'warning',
                                type: 'low_ctr',
                                title: 'Very Low CTR',
                                message: `${campaign.campaignName} has ${campaign.ctr.toFixed(2)}% CTR - creative refresh recommended`,
                                platform,
                                campaignId: campaign.campaignId,
                                campaignName: campaign.campaignName,
                                data: { ctr: campaign.ctr, impressions: campaign.impressions }
                            });
                        }
                    }
                } catch (error) {
                    Logger.warn(`Failed to check alerts for ${adAccount.id}`, { error });
                }
            }

            // Multi-period anomaly alerts
            if (multiPeriod.hasData && multiPeriod.anomalies.length > 0) {
                for (let i = 0; i < multiPeriod.anomalies.length; i++) {
                    const anomaly = multiPeriod.anomalies[i];
                    // Handle both string and object anomalies
                    const message = typeof anomaly === 'string'
                        ? anomaly
                        : (anomaly as any).message || JSON.stringify(anomaly);

                    alerts.push({
                        id: `anomaly_${i}_${Date.now()}`,
                        severity: 'warning',
                        type: 'anomaly_detected',
                        title: 'Performance Anomaly',
                        message,
                        data: { source: 'multi_period_analysis', anomaly }
                    });
                }
            }

            // Deduplicate and sort by severity
            const deduped = this.deduplicateAlerts(alerts);
            deduped.sort((a, b) => {
                const order = { critical: 0, warning: 1, info: 2 };
                return order[a.severity] - order[b.severity];
            });

            // Send critical alerts via NotificationEngine
            await this.sendCriticalAlerts(accountId, deduped.filter(a => a.severity === 'critical'));

            return deduped;
        } catch (error) {
            Logger.error('AdAlertService.checkForAlerts failed', { error, accountId });
            return [];
        }
    }

    /**
     * Check for ROAS crash by comparing current vs previous period.
     */
    private static async checkRoasCrash(
        accountId: string,
        adAccountId: string,
        campaign: any,
        thresholdPercent: number
    ): Promise<AdAlert | null> {
        try {
            // Get historical data from snapshots
            const weekAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
            const twoWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);

            const previousSnapshot = await prisma.adPerformanceSnapshot.findFirst({
                where: {
                    adAccountId,
                    date: { gte: twoWeeksAgo, lt: weekAgo }
                },
                orderBy: { date: 'desc' }
            });

            if (!previousSnapshot || previousSnapshot.roas === 0) return null;

            const roasChange = ((campaign.roas - previousSnapshot.roas) / previousSnapshot.roas) * 100;

            if (roasChange < -thresholdPercent) {
                return {
                    id: `roas_crash_${campaign.campaignId}`,
                    severity: 'critical',
                    type: 'roas_crash',
                    title: '⚠️ ROAS Crash Detected',
                    message: `${campaign.campaignName} ROAS dropped ${Math.abs(roasChange).toFixed(0)}% (${previousSnapshot.roas.toFixed(1)}x → ${campaign.roas.toFixed(1)}x)`,
                    platform: previousSnapshot.platform.toLowerCase() as 'google' | 'meta',
                    campaignId: campaign.campaignId,
                    campaignName: campaign.campaignName,
                    data: {
                        previousRoas: previousSnapshot.roas,
                        currentRoas: campaign.roas,
                        changePercent: roasChange
                    }
                };
            }

            return null;
        } catch (error) {
            Logger.warn('Failed to check ROAS crash', { error, campaignId: campaign.campaignId });
            return null;
        }
    }

    /**
     * Send critical alerts via the notification system.
     */
    private static async sendCriticalAlerts(accountId: string, alerts: AdAlert[]): Promise<void> {
        for (const alert of alerts) {
            try {
                // Emit event for NotificationEngine to handle
                EventBus.emit(EVENTS.AD.ALERT, {
                    accountId,
                    alert
                });

                Logger.info('Sent critical ad alert', {
                    accountId,
                    alertType: alert.type,
                    campaignName: alert.campaignName
                });
            } catch (error) {
                Logger.error('Failed to send critical alert', { error, alert });
            }
        }
    }

    /**
     * Remove duplicate alerts (same type + campaign).
     */
    private static deduplicateAlerts(alerts: AdAlert[]): AdAlert[] {
        const seen = new Set<string>();
        return alerts.filter(alert => {
            const key = `${alert.type}_${alert.campaignId || 'global'}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Get recent alerts for display in dashboard.
     */
    static async getRecentAlerts(accountId: string, limit: number = 10): Promise<AdAlert[]> {
        // For now, just run a fresh check
        // In production, you'd store alerts and query them
        const alerts = await this.checkForAlerts(accountId);
        return alerts.slice(0, limit);
    }
}
