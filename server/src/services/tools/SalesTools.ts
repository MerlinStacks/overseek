import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { SalesAnalytics } from '../analytics/sales';
import { dateKeyInTimezone, normalizeTimezone } from '../../utils/timezone';
import { revenuePeriods, validRevenuePeriod } from './revenuePeriods';
import { text } from './toolData';

export class SalesTools {
    static async getSalesAnalytics(accountId: string, period: string) {
        if (!text(accountId)) return 'Account ID required.';
        if (!validRevenuePeriod(period)) return 'Unsupported sales period.';
        try {
            const account = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true, currency: true } });
            if (!account) return 'Account not found.';
            const timezone = normalizeTimezone(account.timezone);
            const { start, end } = revenuePeriods(period, timezone);
            const totals = end > start
                ? await SalesAnalytics.getTotalSales(accountId, start.toISOString(), new Date(end.getTime() - 1).toISOString(), { throwOnError: true })
                : { total: 0, count: 0 };
            return { period, total_sales: totals.total, order_count: totals.count, start_date: dateKeyInTimezone(start, timezone), currency: account.currency };
        } catch (error) {
            Logger.error('Tool Error (getSalesAnalytics)', { error });
            return 'Failed to calculate analytics.';
        }
    }
}
