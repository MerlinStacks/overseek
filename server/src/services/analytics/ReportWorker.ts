
import { Job } from 'bullmq';
import { prisma } from '../../utils/prisma';
import { SalesAnalytics } from './sales';
import { DigestReportService } from './DigestReportService';
import { EmailService } from '../EmailService';
import { Logger } from '../../utils/logger';

export class ReportWorker {

    static async process(job: Job) {
        const { scheduleId, accountId } = job.data;

        Logger.info(`[ReportWorker] Processing Schedule ${scheduleId} for Account ${accountId}`);

        try {
            const schedule = await prisma.reportSchedule.findUnique({
                where: { id: scheduleId },
                include: { template: true, account: true }
            });

            if (!schedule || !schedule.isActive) {
                Logger.info(`[ReportWorker] Schedule not active or found. Skipping.`);
                return;
            }

            // Get email account for sending
            const { getDefaultEmailAccount } = await import('../../utils/getDefaultEmailAccount');
            const emailAccount = await getDefaultEmailAccount(accountId);

            if (!emailAccount) {
                Logger.warn(`[ReportWorker] No default SMTP account found for Account ${accountId}. Cannot send email.`);
                return;
            }

            let html: string;
            let subject: string;

            // Handle DIGEST type reports
            if (schedule.reportType === 'DIGEST') {
                const currency = schedule.account.currency || 'USD';

                if (schedule.frequency === 'DAILY') {
                    const digestData = await DigestReportService.generateDailyDigest(accountId);
                    html = DigestReportService.generateHtml(digestData, currency);
                    subject = `📊 Daily Digest - ${new Date().toLocaleDateString()}`;
                } else {
                    // Weekly or default
                    const digestData = await DigestReportService.generateWeeklyDigest(accountId);
                    html = DigestReportService.generateHtml(digestData, currency);
                    subject = `📊 Weekly Digest - ${new Date().toLocaleDateString()}`;
                }
            } else {
                // Handle CUSTOM type reports (existing logic)
                if (!schedule.template) {
                    Logger.warn(`[ReportWorker] CUSTOM schedule ${scheduleId} has no template. Skipping.`);
                    return;
                }

                const config = schedule.template.config as any;
                const { startDate, endDate } = this.resolveDateRange(config.dateRange || '30d');

                const reportData = await SalesAnalytics.getCustomReport(accountId, {
                    metrics: config.metrics || ['sales'],
                    dimension: config.dimension || 'day',
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString()
                });

                html = this.generateHtml(schedule.template.name, reportData, config);
                subject = `[Report] ${schedule.template.name} - ${new Date().toLocaleDateString()}`;
            }

            // Send Email
            if (schedule.emailRecipients && schedule.emailRecipients.length > 0) {
                const emailService = new EmailService();

                for (const recipient of schedule.emailRecipients) {
                    await emailService.sendEmail(
                        accountId,
                        emailAccount.id,
                        recipient,
                        subject,
                        html
                    );
                }
            }

            // Update Last Run
            await prisma.reportSchedule.update({
                where: { id: scheduleId },
                data: { lastRunAt: new Date() }
            });

        } catch (error: any) {
            Logger.error(`[ReportWorker] Failed: ${error.message}`, { error });
            throw error; // Retry
        }
    }

    private static resolveDateRange(range: string): { startDate: Date, endDate: Date } {
        const end = new Date();
        const start = new Date();

        if (range === 'today') {
            start.setHours(0, 0, 0, 0);
        } else if (range === '7d') {
            start.setDate(start.getDate() - 7);
        } else if (range === '30d') {
            start.setDate(start.getDate() - 30);
        } else if (range === '90d') {
            start.setDate(start.getDate() - 90);
        } else if (range === 'ytd') {
            start.setMonth(0, 1);
        } else {
            // Default 30d
            start.setDate(start.getDate() - 30);
        }

        return { startDate: start, endDate: end };
    }

    private static generateHtml(title: string, data: any[], config: any): string {
        const metrics = (config.metrics || ['sales']) as string[];
        const dimension = config.dimension || 'day';

        const headers = ['Dimension', ...metrics];

        const rows = data.map(row => {
            const cells = [
                row.dimension,
                ...metrics.map(m => {
                    const val = row[m];
                    if (typeof val === 'number') {
                        if (m === 'sales' || m === 'aov') return `$${val.toFixed(2)}`;
                        return val.toLocaleString();
                    }
                    return val;
                })
            ];

            return `<tr>${cells.map(c => `<td style="padding: 8px; border-bottom: 1px solid #ddd;">${c}</td>`).join('')}</tr>`;
        }).join('');

        return `
            <div style="font-family: Arial, sans-serif; color: #333;">
                <h2>${title}</h2>
                <p>Report generated on ${new Date().toLocaleString()}</p>
                
                <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                    <thead>
                        <tr style="background-color: #f5f5f5; text-align: left;">
                            ${headers.map(h => `<th style="padding: 10px; border-bottom: 2px solid #ddd; text-transform: capitalize;">${h}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
                
                <p style="margin-top: 30px; font-size: 12px; color: #888;">
                    Generated by OverSeek
                </p>
            </div>
        `;
    }
}
