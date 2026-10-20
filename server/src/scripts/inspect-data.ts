import { esClient } from '../utils/elastic';
import { requiredAccountId, runScript } from './scriptUtils';

interface OrderInspection {
    id?: number;
    total?: number;
    line_items?: Array<{ productId?: number; variationId?: number; quantity?: number; total?: number }>;
}

/** Usage: --account-id <account-id>. Never reads an arbitrary tenant's order. */
export async function main(args = process.argv.slice(2)) {
    try {
        const accountId = requiredAccountId(args);
        const response = await esClient.search<OrderInspection>({
            index: 'orders', size: 1, query: { term: { accountId } },
            _source: ['id', 'total', 'line_items.productId', 'line_items.variationId', 'line_items.quantity', 'line_items.total'],
        });
        const source = response.hits.hits[0]?._source;
        if (!source) { console.log('No orders found for this account.'); return; }
        console.log('Order ID:', source.id);
        console.log('Total:', source.total);
        // Explicit projection also prevents accidental output if the response contains extra fields.
        console.log('Line Items:', JSON.stringify(Array.isArray(source.line_items) ? source.line_items.map(item => ({
            productId: item.productId, variationId: item.variationId, quantity: item.quantity, total: item.total,
        })) : [], null, 2));
    } finally {
        await esClient.close();
    }
}

if (require.main === module) void runScript(main);
