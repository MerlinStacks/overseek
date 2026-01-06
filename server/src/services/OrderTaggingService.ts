import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

/**
 * Service for computing order tags from product tags in line items.
 * Tags are extracted from products referenced in order line items.
 */
export class OrderTaggingService {

    /**
     * Extract unique tags from order line items by looking up product tags.
     * @param accountId - The account ID
     * @param rawOrderData - Raw WooCommerce order data containing line_items
     * @returns Array of unique tag names
     */
    static async extractTagsFromOrder(accountId: string, rawOrderData: any): Promise<string[]> {
        const lineItems = rawOrderData?.line_items || [];
        if (lineItems.length === 0) return [];

        // Get unique product IDs from line items
        const productIds = [...new Set(
            lineItems
                .map((item: any) => item.product_id)
                .filter((id: number) => id && id > 0)
        )] as number[];

        if (productIds.length === 0) return [];

        // Fetch products from database
        const products = await prisma.wooProduct.findMany({
            where: {
                accountId,
                wooId: { in: productIds }
            },
            select: { wooId: true, rawData: true }
        });

        // Extract unique tags across all products
        const tagSet = new Set<string>();
        for (const product of products) {
            const rawData = product.rawData as any;
            const tags = rawData?.tags || [];
            for (const tag of tags) {
                if (tag?.name) {
                    tagSet.add(tag.name);
                }
            }
        }

        return Array.from(tagSet);
    }

    /**
     * Compute and return tags for a specific order by ID.
     * @param accountId - The account ID
     * @param orderId - The internal order UUID
     * @returns Array of tag names
     */
    static async computeOrderTags(accountId: string, orderId: string): Promise<string[]> {
        const order = await prisma.wooOrder.findUnique({
            where: { id: orderId }
        });

        if (!order || order.accountId !== accountId) {
            return [];
        }

        return this.extractTagsFromOrder(accountId, order.rawData);
    }

    /**
     * Retag all orders for an account. Useful for backfilling tags on existing orders.
     * @param accountId - The account ID
     * @returns Summary of retagging operation
     */
    static async retagAllOrders(accountId: string): Promise<{ processed: number; tagged: number }> {
        let processed = 0;
        let tagged = 0;

        // Process orders in batches
        const batchSize = 100;
        let skip = 0;
        let hasMore = true;

        while (hasMore) {
            const orders = await prisma.wooOrder.findMany({
                where: { accountId },
                select: { id: true, wooId: true, rawData: true },
                take: batchSize,
                skip
            });

            if (orders.length === 0) {
                hasMore = false;
                break;
            }

            for (const order of orders) {
                const tags = await this.extractTagsFromOrder(accountId, order.rawData);
                if (tags.length > 0) {
                    tagged++;
                }
                processed++;
                // Note: Tags are stored in ES, not in Prisma. 
                // Caller should re-index after computing tags.
            }

            skip += batchSize;
            if (orders.length < batchSize) hasMore = false;
        }

        Logger.info(`Retagging complete`, { accountId, processed, tagged });
        return { processed, tagged };
    }

    /**
     * Get all unique tags used across orders for an account.
     * This aggregates from ES index.
     * @param accountId - The account ID
     * @returns Array of unique tag names
     */
    static async getAccountTags(accountId: string): Promise<string[]> {
        // This will be implemented via ES aggregation in SearchQueryService
        // Leaving as stub for now
        return [];
    }
}
