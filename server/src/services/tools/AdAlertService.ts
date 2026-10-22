import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { EventBus, EVENTS } from '../events';
import { AdsService } from '../ads';
import { boundedRead, currencyCode, nonnegative, trustedAccount } from './analysisObservations';

export type AlertSeverity = 'critical' | 'warning' | 'info';
export interface AdAlert { id: string; severity: AlertSeverity; type: string; title: string; message: string; platform?: 'google' | 'meta'; adAccountId?: string; campaignId?: string; campaignName?: string; data: Record<string, unknown> }
export interface AlertThresholds { roasCrashPercent: number; budgetDepletionPercent: number; conversionZeroDays: number; ctrDropPercent: number }
const thresholdsSchema = z.object({ roasCrashPercent: z.number().min(1).max(100).default(30), budgetDepletionPercent: z.number().min(1).max(100).default(80), conversionZeroDays: z.number().int().min(1).max(30).default(3), ctrDropPercent: z.number().min(1).max(100).default(40) }).strict();
export class AdAlertService {
    /** Detection is read-only. Persistence/admission to notification dispatch happens separately. */
    static async checkForAlerts(accountId: string, thresholds: Partial<AlertThresholds> = {}) {
        trustedAccount(accountId); const config = thresholdsSchema.parse(thresholds);
        const accounts = await prisma.adAccount.findMany({ where: { accountId }, select: { id: true, platform: true }, orderBy: { id: 'asc' }, take: 51 });
        if (accounts.length > 50) throw new Error('Alert account limit exceeded');
        const outcomes = await Promise.allSettled(accounts.map(async account => {
            if (!['GOOGLE', 'META'].includes(account.platform)) throw new Error('Unsupported platform');
            const campaigns = await boundedRead(account.platform === 'GOOGLE' ? AdsService.getGoogleCampaignInsights(account.id, config.conversionZeroDays, { strict: true }) : AdsService.getMetaCampaignInsights(account.id, config.conversionZeroDays));
            if (!Array.isArray(campaigns) || campaigns.length > 1000) throw new Error('Invalid campaigns');
            const seen = new Set<string>(); const alerts: AdAlert[] = [];
            for (const campaign of campaigns) {
                const code = currencyCode(campaign.currency), start = Date.parse(`${campaign.dateStart}T00:00:00Z`), end = Date.parse(`${campaign.dateStop}T00:00:00Z`);
                if (!code || !Number.isFinite(start) || !Number.isFinite(end) || end < start || !/^\d{4}-\d{2}-\d{2}$/.test(campaign.dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(campaign.dateStop) ||
                    typeof campaign.campaignId !== 'string' || !campaign.campaignId || campaign.campaignId.length > 200 || seen.has(campaign.campaignId) || ![campaign.spend, campaign.conversions, campaign.clicks, campaign.impressions].every(nonnegative)) throw new Error('Invalid campaign observations');
                seen.add(campaign.campaignId);
                // Do not compare campaign ROAS against an account snapshot or infer an actual budget.
                if (campaign.conversions === 0 && campaign.spend > 0 && (end - start) / 86400000 + 1 >= config.conversionZeroDays) {
                    const platform = account.platform.toLowerCase() as 'google' | 'meta';
                    const id = crypto.createHash('sha256').update(JSON.stringify([accountId, account.id, platform, campaign.campaignId, 'zero_conversions', campaign.dateStart, campaign.dateStop])).digest('hex');
                    alerts.push({ id, severity: 'warning', type: 'zero_conversions', title: 'No reported conversions in returned window',
                        message: `${String(campaign.campaignName).slice(0, 500)}: ${code} ${campaign.spend.toFixed(2)} spend and zero reported conversions, ${campaign.dateStart} to ${campaign.dateStop}. Check tracking and reporting latency before changing spend.`,
                        platform, adAccountId: account.id, campaignId: campaign.campaignId, campaignName: String(campaign.campaignName).slice(0, 500),
                        data: { spend: campaign.spend, currency: code, startDate: campaign.dateStart, endDate: campaign.dateStop, daysRequested: config.conversionZeroDays, basis: 'returned-provider-window-not-verified-daily-coverage' } });
                }
            }
            return alerts;
        }));
        return { alerts: outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? outcome.value : []), coverage: { expected: accounts.length, observed: outcomes.filter(outcome => outcome.status === 'fulfilled').length,
            complete: false, unavailableChecks: ['roas-crash: compatible campaign history unavailable', 'ctr-drop: compatible campaign history unavailable', 'budget-depletion: actual budget unavailable'],
            thresholds: config, note: 'Only zero-conversion observations are evaluated. Other thresholds are validated but explicitly unsupported, not silently treated as passing.' } };
    }
    static async persistAndDispatch(accountId: string, alerts: AdAlert[]) {
        trustedAccount(accountId);
        if (!Array.isArray(alerts) || alerts.length > 1000) throw new Error('Invalid alert batch');
        if (alerts.length) await prisma.adAlert.createMany({ skipDuplicates: true, data: alerts.map(alert => ({ id: alert.id, accountId, severity: alert.severity, type: alert.type, title: alert.title, message: alert.message,
            platform: alert.platform, adAccountId: alert.adAccountId, campaignId: alert.campaignId, campaignName: alert.campaignName, data: JSON.parse(JSON.stringify(alert.data)), notificationStatus: 'pending' })) });
        await this.sendCriticalAlerts(accountId);
    }
    /** At-most-once dispatch claim. The event bus does not acknowledge delivery; never call it delivered. */
    static async sendCriticalAlerts(accountId: string, _alerts?: AdAlert[]): Promise<void> {
        trustedAccount(accountId);
        const pending = await prisma.adAlert.findMany({ where: { accountId, severity: 'critical', notificationStatus: 'pending' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100 });
        for (const alert of pending) {
            const claim = await prisma.adAlert.updateMany({ where: { id: alert.id, accountId, notificationStatus: 'pending' }, data: { notificationStatus: 'claimed' } });
            if (claim.count !== 1) continue;
            try {
                EventBus.emit(EVENTS.AD.ALERT, { accountId, alert });
                await prisma.adAlert.updateMany({ where: { id: alert.id, accountId, notificationStatus: 'claimed' }, data: { notificationStatus: 'dispatched-unconfirmed' } });
            } catch { await prisma.adAlert.updateMany({ where: { id: alert.id, accountId, notificationStatus: 'claimed' }, data: { notificationStatus: 'uncertain' } }); }
        }
    }
    static async getRecentAlerts(accountId: string, limit = 10): Promise<AdAlert[]> {
        trustedAccount(accountId); if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid alert limit');
        const rows = await prisma.adAlert.findMany({ where: { accountId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit });
        return rows.map(row => ({ id: row.id, severity: row.severity as AlertSeverity, type: row.type, title: row.title, message: row.message, platform: row.platform?.toLowerCase() as 'google' | 'meta' | undefined,
            adAccountId: row.adAccountId || undefined, campaignId: row.campaignId || undefined, campaignName: row.campaignName || undefined, data: { ...(row.data as Record<string, unknown> || {}), notificationStatus: row.notificationStatus } }));
    }
}
