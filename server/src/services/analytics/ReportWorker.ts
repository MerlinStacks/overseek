
import { Job } from 'bullmq';
import { prisma } from '../../utils/prisma';
import { SalesAnalytics } from './sales';
import { DigestReportService } from './DigestReportService';
import { EmailService } from '../EmailService';
import { Logger } from '../../utils/logger';
import { z } from 'zod';
import { createHash } from 'crypto';
import { escapeReportHtml, reportCurrency } from './utils/reportFormatting';

export class ReportWorker {

    static async process(job: Job) {
        const { scheduleId, accountId, runAt } = z.object({ scheduleId: z.string().min(1), accountId: z.string().min(1), runAt: z.iso.datetime() }).parse(job.data);
        const occurrence = new Date(runAt);
        if (occurrence.getTime() > Date.now()) throw new Error('Report occurrence is in the future');

        Logger.info(`[ReportWorker] Processing Schedule ${scheduleId} for Account ${accountId}`);

        try {
            const schedule = await prisma.reportSchedule.findFirst({
                where: { id: scheduleId, accountId },
                include: { template: true, account: true }
            });

            if (!schedule || !schedule.isActive) {
                Logger.info(`[ReportWorker] Schedule not active or found. Skipping.`);
                return;
            }
            if (schedule.account.id !== accountId || schedule.template && schedule.template.accountId !== accountId) throw new Error('Report ownership mismatch');
            const recipients = [...new Set(z.array(z.email().transform(email => email.toLowerCase())).min(1).max(100).parse(schedule.emailRecipients))];
            const currency = reportCurrency(schedule.account.currency);

            // Get email account for sending
            const { getDefaultEmailAccount } = await import('../../utils/getDefaultEmailAccount');
            const emailAccount = await getDefaultEmailAccount(accountId);

            if (!emailAccount || emailAccount.accountId !== accountId) {
                Logger.warn(`[ReportWorker] No default SMTP account found for Account ${accountId}. Cannot send email.`);
                throw new Error('Report sender unavailable in account');
            }

            let html: string;
            let subject: string;

            // Handle DIGEST type reports
            if (schedule.reportType === 'DIGEST') {

                if (schedule.frequency === 'DAILY') {
                    const digestData = await DigestReportService.generateDailyDigest(accountId, occurrence);
                    html = DigestReportService.generateHtml(digestData, currency);
                    subject = `📊 Daily Digest - ${occurrence.toLocaleDateString()}`;
                } else {
                    // Weekly or default
                    if (schedule.frequency !== 'WEEKLY') throw new Error('Unsupported digest frequency');
                    const digestData = await DigestReportService.generateWeeklyDigest(accountId, occurrence);
                    html = DigestReportService.generateHtml(digestData, currency);
                    subject = `📊 Weekly Digest - ${occurrence.toLocaleDateString()}`;
                }
            } else {
                if (schedule.reportType !== 'CUSTOM') throw new Error('Unsupported report type');
                // Handle CUSTOM type reports (existing logic)
                if (!schedule.template) {
                    Logger.warn(`[ReportWorker] CUSTOM schedule ${scheduleId} has no template. Skipping.`);
                    throw new Error('Custom report template unavailable');
                }

                const config = z.object({ dateRange: z.enum(['today', 'yesterday', '7d', '30d', '90d', 'ytd']).default('30d'),
                    metrics: z.array(z.enum(['sales', 'orders', 'aov', 'quantity', 'visitors', 'sessions', 'page_views', 'conversion_rate', 'new_customers'])).min(1).max(9).default(['sales']),
                    dimension: z.enum(['day', 'month', 'product', 'category', 'customer', 'customer_segment', 'traffic_source', 'utm_source', 'utm_medium', 'utm_campaign', 'device', 'country', 'order_status']).default('day') }).passthrough().parse(schedule.template.config);
                const { startDate, endDate } = this.resolveDateRange(config.dateRange, occurrence);
                if (config.metrics.some(metric => ['sales', 'aov'].includes(metric))) {
                    const currencies = await prisma.wooOrder.groupBy({ by: ['currency'], where: { accountId, dateCreated: { gte: startDate, lte: endDate } } });
                    if (currencies.some(row => row.currency !== currency)) throw new Error('Report order currency does not match account currency');
                }

                const reportData = await SalesAnalytics.getCustomReport(accountId, {
                    metrics: config.metrics || ['sales'],
                    dimension: config.dimension || 'day',
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString()
                }, { throwOnError: true });

                html = this.generateHtml(schedule.template.name, reportData, config, currency);
                subject = `[Report] ${schedule.template.name.replace(/[\r\n]/g, ' ')} - ${occurrence.toLocaleDateString()}`;
            }

            // Send Email
            if (schedule.emailRecipients && schedule.emailRecipients.length > 0) {
                const emailService = new EmailService();

                for (const recipient of recipients) {
                    const outcome = await emailService.sendEmail(
                        accountId,
                        emailAccount.id,
                        recipient,
                        subject,
                        html,
                        undefined,
                        { idempotencyKey: `report-${createHash('sha256').update(JSON.stringify([accountId, scheduleId, runAt, recipient])).digest('hex')}` }
                    );
                    if (outcome?.skipped || !outcome?.messageId && !outcome?.deduplicated) throw new Error('Report email delivery not confirmed');
                }
            }
            // Only confirmed/deduplicated successful deliveries reach this point.
            await prisma.reportSchedule.updateMany({ where: { id: scheduleId, accountId, OR: [{ lastRunAt: null }, { lastRunAt: { lt: occurrence } }] }, data: { lastRunAt: occurrence } });

        } catch (error: any) {
            Logger.error(`[ReportWorker] Failed: ${error.message}`, { error });
            throw error; // Retry
        }
    }

    private static resolveDateRange(range: string, reference = new Date()): { startDate: Date, endDate: Date } {
        const end = new Date(reference);
        const start = new Date(reference);

        if (range === 'today') {
            start.setHours(0, 0, 0, 0);
        } else if (range === 'yesterday') {
            end.setHours(0, 0, 0, 0); end.setMilliseconds(-1);
            start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0);
        } else if (range === '7d') {
            start.setDate(start.getDate() - 7);
        } else if (range === '30d') {
            start.setDate(start.getDate() - 30);
        } else if (range === '90d') {
            start.setDate(start.getDate() - 90);
        } else if (range === 'ytd') {
            start.setMonth(0, 1);
            start.setHours(0, 0, 0, 0);
        } else {
            // Default 30d
            throw new Error('Unsupported report date range');
        }

        return { startDate: start, endDate: end };
    }

    private static generateHtml(title: string, data: any[], config: any, currency: string): string {
        const metrics = (config.metrics || ['sales']) as string[];

        const headers = ['Dimension', ...metrics];

        const rows = data.map(row => {
            const cells = [
                row.dimension,
                ...metrics.map(m => {
                    const val = row[m];
                    if (typeof val === 'number') {
                        if (!Number.isFinite(val)) return 'Unavailable';
                        if (m === 'sales' || m === 'aov') return new Intl.NumberFormat('en-US', { style: 'currency', currency: reportCurrency(currency) }).format(val);
                        return val.toLocaleString();
                    }
                    return val;
                })
            ];

            return `<tr>${cells.map(c => `<td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeReportHtml(c)}</td>`).join('')}</tr>`;
        }).join('');

        return `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h2>${escapeReportHtml(title)}</h2>
                <p>Report generated on ${new Date().toLocaleString()}</p>
                
                <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                    <thead>
                        <tr style="background-color: #f5f5f5; text-align: left;">
                            ${headers.map(h => `<th style="padding: 10px; border-bottom: 2px solid #ddd; text-transform: capitalize;">${escapeReportHtml(h)}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
                
                <p style="margin-top: 30px; font-size: 12px; color: #888;">
                    Generated by ${escapeReportHtml(process.env.APP_NAME || 'Commerce Platform')}
                </p>
            </div>
        `;
    }
}
