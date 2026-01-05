
import { Job } from 'bullmq';
import { prisma } from '../../utils/prisma';
import { SalesAnalytics } from './sales';
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

            // 1. Generate Data
            const config = schedule.template.config as any;

            // Adjust Date Range if it's dynamic (e.g. "Last 30 Days")
            // The template config usually has relative range like "30d", "7d".
            // SalesAnalytics.getCustomReport handles "30d" internally via getSalesOverTime logic?
            // Wait, getCustomReport expects { startDate: string, endDate: string } in current implementation?
            // Let's check SalesAnalytics.getCustomReport signature.
            // It expects { metrics, dimension, startDate, endDate }.
            // We need to resolve "30d" to actual dates here.

            const { startDate, endDate } = this.resolveDateRange(config.dateRange || '30d');

            const reportData = await SalesAnalytics.getCustomReport(accountId, {
                metrics: config.metrics || ['sales'],
                dimension: config.dimension || 'day',
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString()
            });

            // 2. Format HTML
            const html = this.generateHtml(schedule.template.name, reportData, config);

            // 3. Send Email
            if (schedule.emailRecipients && schedule.emailRecipients.length > 0) {
                // We need an email account to send FROM.
                // We'll pick the default SMTP account for the user's account, or system default?
                // For MVP, user's default email account.
                const emailAccount = await prisma.emailAccount.findFirst({
                    where: { accountId, isDefault: true, type: 'SMTP' }
                });

                if (!emailAccount) {
                    Logger.warn(`[ReportWorker] No default SMTP account found for Account ${accountId}. Cannot send email.`);
                    // Ideally fallback to a system "noreply@overseek.io" if enabled.
                    return;
                }

                const emailService = new EmailService();
                const subject = `[Report] ${schedule.template.name} - ${new Date().toLocaleDateString()}`;

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

            // 4. Update Last Run
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
