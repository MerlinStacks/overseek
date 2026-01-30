import { esClient } from '../../utils/elastic';
import { Logger } from '../../utils/logger';

export class CustomerAnalytics {

    /**
     * Get Customer Acquisition Over Time
     */
    static async getCustomerGrowth(accountId: string, startDate?: string, endDate?: string) {
        try {
            const response = await esClient.search({
                index: 'customers',
                size: 0,
                query: {
                    bool: {
                        must: [
                            { term: { accountId } },
                            { range: { dateCreated: { gte: startDate, lte: endDate } } }
                        ]
                    }
                },
                aggs: {
                    growth_over_time: {
                        date_histogram: {
                            field: 'dateCreated',
                            calendar_interval: 'month',
                            format: 'yyyy-MM-dd'
                        },
                        aggs: { count: { value_count: { field: 'id' } } }
                    }
                }
            });

            const buckets = (response.aggregations as any)?.growth_over_time?.buckets || [];
            return buckets.map((b: any) => ({
                date: b.key_as_string,
                newCustomers: b.count.value
            }));

        } catch (error) {
            Logger.error('Analytics Customer Growth Error', { error });
            return [];
        }
    }
}
