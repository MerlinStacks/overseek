import { esClient } from '../../utils/elastic';
import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';
import { normalizeTimezone, startOfDateInTimezone } from '../../utils/timezone';

function rangeDate(value: string | undefined, timezone: string, end: boolean): string | undefined {
    if (!value) return undefined;
    let date: Date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Invalid date');
        if (end) {
            const next = new Date(`${value}T00:00:00Z`);
            next.setUTCDate(next.getUTCDate() + 1);
            date = new Date(startOfDateInTimezone(next.toISOString().slice(0, 10), timezone).getTime() - 1);
        } else date = startOfDateInTimezone(value, timezone);
    } else date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid date');
    return date.toISOString();
}

export class CustomerAnalytics {

    /**
     * Get Customer Acquisition Over Time
     */
    static async getCustomerGrowth(accountId: string, startDate?: string, endDate?: string) {
        try {
            const account = await prisma.account.findUnique({ where: { id: accountId }, select: { timezone: true } });
            if (!account) throw new Error('Account not found');
            const timezone = normalizeTimezone(account.timezone);
            const start = rangeDate(startDate, timezone, false);
            const end = rangeDate(endDate, timezone, true);
            if (start && end && start > end) throw new Error('Invalid date range');
            const response = await esClient.search({
                index: 'customers',
                size: 0,
                query: {
                    bool: {
                        must: [
                            { term: { accountId } },
                            ...(start || end ? [{ range: { dateCreated: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } }] : [])
                        ]
                    }
                },
                aggs: {
                    growth_over_time: {
                        date_histogram: {
                            field: 'dateCreated',
                            calendar_interval: 'month',
                            format: 'yyyy-MM-dd',
                            time_zone: timezone,
                            min_doc_count: 0,
                            // String bounds are parsed using the histogram's output format.
                            // Epoch milliseconds preserve exact timezone-adjusted instants.
                            ...(start && end ? { extended_bounds: { min: Date.parse(start), max: Date.parse(end) } } : {})
                        },
                    }
                }
            });

            const buckets = (response.aggregations as any)?.growth_over_time?.buckets || [];
            return buckets.map((b: any) => ({
                date: b.key_as_string,
                newCustomers: b.doc_count
            }));

        } catch (error) {
            Logger.error('Analytics Customer Growth Error', { error });
            throw error;
        }
    }
}
