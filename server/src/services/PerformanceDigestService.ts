import { prisma } from '../utils/prisma';
import { scopeId } from './BoundedProviderWork';
import { z } from 'zod';
export interface DigestMetrics {
    periodStart: Date; periodEnd: Date; basis: string; complete: boolean;
    orders: number | null; revenueByCurrency: Record<string, number> | null;
    ads: null; comparisons: null; newCustomers: null; savings: null; unavailable: string[];
}
export interface PerformanceDigest { accountId: string; period: 'weekly' | 'monthly'; metrics: DigestMetrics; narrative: string; html: string; subject: string }
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** Review-only local observations. No provider/AI calls or implicit email consent. */
export class PerformanceDigestService {
    static async generateDigest(accountId: string, period: 'weekly' | 'monthly' = 'weekly'): Promise<PerformanceDigest> {
        scopeId.parse(accountId); z.enum(['weekly', 'monthly']).parse(period);
        const account = await prisma.account.findUnique({ where: { id: accountId }, select: { name: true } });
        if (!account) throw new Error('Account unavailable');
        const periodEnd = new Date(), periodStart = new Date(periodEnd.getTime() - (period === 'weekly' ? 7 : 30) * 86400000);
        const metrics = await this.gatherMetrics(accountId, periodStart, periodEnd);
        const narrative = metrics.complete ? `${metrics.orders} locally synced processing/completed orders in the half-open observation window. This is not certified settled revenue or complete provider coverage.` : 'Local order coverage is incomplete/unavailable. No revenue total is asserted.';
        const subject = `${account.name} — ${period} local observation review`;
        const html = `<h1>${escape(subject)}</h1><p>${escape(narrative)}</p><p>${escape(periodStart.toISOString())} ≤ created &lt; ${escape(periodEnd.toISOString())}</p><p>Ads, period comparisons, new-customer cohorts and savings: unavailable.</p>${Object.entries(metrics.revenueByCurrency ?? {}).map(([currency, amount]) => `<p>${escape(currency)} ${escape(amount.toFixed(2))} gross recorded order total (not net profit)</p>`).join('')}`;
        return { accountId, period, metrics, narrative, html, subject };
    }
    static async gatherMetrics(accountId: string, periodStart: Date, periodEnd: Date): Promise<DigestMetrics> {
        scopeId.parse(accountId);
        if (!(periodStart instanceof Date) || !(periodEnd instanceof Date) || !Number.isFinite(+periodStart) || !Number.isFinite(+periodEnd) || +periodEnd <= +periodStart || +periodEnd - +periodStart > 31 * 86400000) throw new Error('Bounded digest window required');
        const rows = await prisma.wooOrder.findMany({ where: { accountId, dateCreated: { gte: periodStart, lt: periodEnd }, status: { in: ['processing', 'completed'] } }, orderBy: [{ dateCreated: 'asc' }, { id: 'asc' }], take: 5001, select: { total: true, currency: true } });
        const unavailable = ['Ad provider window/currency evidence', 'Comparable previous window', 'New-customer cohort', 'Verified savings'];
        let complete = rows.length <= 5000; const totals: Record<string, number> = {};
        for (const row of rows) {
            const amount = Number(row.total);
            if (row.total == null || !Number.isFinite(amount) || amount < 0 || amount > 1e12 || !row.currency || !/^[A-Z]{3}$/.test(row.currency)) { complete = false; continue; }
            totals[row.currency] = (totals[row.currency] ?? 0) + amount;
            if (totals[row.currency] > 1e12) complete = false;
        }
        if (!complete) unavailable.push('Complete bounded local order totals');
        return { periodStart, periodEnd, basis: 'Locally synced processing/completed gross orders; refunds/settlement and provider completeness unknown', complete, orders: complete ? rows.length : null, revenueByCurrency: complete ? totals : null, ads: null, comparisons: null, newCustomers: null, savings: null, unavailable };
    }
    static async sendDigest(_accountId: string, _period: 'weekly' | 'monthly' = 'weekly'): Promise<never> {
        throw new Error('Digest delivery disabled: recipient consent, stable occurrence admission and delivery reconciliation are required. Generate a review-only observation instead.');
    }
}
export default PerformanceDigestService;
