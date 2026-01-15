import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

/**
 * Tag mapping configuration stored in Account.orderTagMappings
 */
interface TagMapping {
    productTag: string;  // The tag name from WooCommerce product
    orderTag: string;    // The tag name to apply to orders
    enabled: boolean;    // Whether this mapping is active
    color?: string;      // Optional hex color for display (e.g. "#3B82F6")
}

/**
 * Service for computing order tags from product tags using configurable mappings.
 * Only applies tags that have an enabled mapping in the account settings.
 */
export class OrderTaggingService {

    /**
     * Get tag mappings for an account
     */
    static async getTagMappings(accountId: string): Promise<TagMapping[]> {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { orderTagMappings: true }
        });

        if (!account?.orderTagMappings) return [];

        try {
            const mappings = account.orderTagMappings as unknown as TagMapping[];
            return Array.isArray(mappings) ? mappings : [];
        } catch {
            return [];
        }
    }

    /**
     * Save tag mappings for an account
     */
    static async saveTagMappings(accountId: string, mappings: TagMapping[]): Promise<void> {
        await prisma.account.update({
            where: { id: accountId },
            data: { orderTagMappings: mappings as any }
        });
        Logger.info('Tag mappings saved', { accountId, count: mappings.length });
    }

    /**
     * Batch extract tags for multiple orders.
     * Efficiently fetches products in a single query.
     * @param accountId - The account ID
     * @param orders - Array of raw WooCommerce order data
     * @returns Map of orderId -> Array of mapped order tag names
     */
    static async extractTagsForOrders(accountId: string, orders: any[]): Promise<Map<number, string[]>> {
        const result = new Map<number, string[]>();
        if (!orders.length) return result;

        // Initialize empty arrays for all orders
        for (const order of orders) {
            if (order.id) result.set(order.id, []);
        }

        // Get tag mappings for this account
        const mappings = await this.getTagMappings(accountId);
        const enabledMappings = mappings.filter(m => m.enabled);

        // If no mappings configured, return empty map (all orders have empty tags)
        if (enabledMappings.length === 0) return result;

        // Build lookup: productTag -> orderTag
        const mappingLookup = new Map<string, string>();
        for (const m of enabledMappings) {
            mappingLookup.set(m.productTag.toLowerCase(), m.orderTag);
        }

        // Collect all unique product IDs from all orders
        const allProductIds = new Set<number>();
        const orderProductMap = new Map<number, number[]>(); // orderId -> productIds

        for (const order of orders) {
            const lineItems = order.line_items || [];
            const pIds = lineItems
                .map((item: any) => item.product_id)
                .filter((id: number) => id && id > 0);

            if (pIds.length > 0) {
                orderProductMap.set(order.id, pIds);
                pIds.forEach((id: number) => allProductIds.add(id));
            }
        }

        if (allProductIds.size === 0) return result;

        // Fetch products from database
        const products = await prisma.wooProduct.findMany({
            where: {
                accountId,
                wooId: { in: Array.from(allProductIds) }
            },
            select: { wooId: true, rawData: true }
        });

        // Create product lookup map
        const productLookup = new Map<number, any>();
        for (const product of products) {
            productLookup.set(product.wooId, product.rawData);
        }

        // Process each order
        for (const order of orders) {
            const orderId = order.id;
            const pIds = orderProductMap.get(orderId);

            if (!pIds || pIds.length === 0) continue;

            const orderTags = new Set<string>();
            for (const pid of pIds) {
                const rawData = productLookup.get(pid);
                if (rawData) {
                    const tags = rawData.tags || [];
                    for (const tag of tags) {
                        if (tag?.name) {
                            const mappedTag = mappingLookup.get(tag.name.toLowerCase());
                            if (mappedTag) {
                                orderTags.add(mappedTag);
                            }
                        }
                    }
                }
            }
            result.set(orderId, Array.from(orderTags));
        }

        return result;
    }

    /**
     * Extract tags from order line items and apply mappings.
     * Only returns tags that have an enabled mapping defined.
     * @param accountId - The account ID
     * @param rawOrderData - Raw WooCommerce order data containing line_items
     * @returns Array of mapped order tag names
     */
    static async extractTagsFromOrder(accountId: string, rawOrderData: any): Promise<string[]> {
        const lineItems = rawOrderData?.line_items || [];
        if (lineItems.length === 0) return [];

        // Get tag mappings for this account
        const mappings = await this.getTagMappings(accountId);
        const enabledMappings = mappings.filter(m => m.enabled);

        // If no mappings configured, return empty (user must configure first)
        if (enabledMappings.length === 0) return [];

        // Build lookup: productTag -> orderTag
        const mappingLookup = new Map<string, string>();
        for (const m of enabledMappings) {
            mappingLookup.set(m.productTag.toLowerCase(), m.orderTag);
        }

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

        // Extract product tags and apply mappings
        const orderTags = new Set<string>();
        for (const product of products) {
            const rawData = product.rawData as any;
            const tags = rawData?.tags || [];
            for (const tag of tags) {
                if (tag?.name) {
                    const mappedTag = mappingLookup.get(tag.name.toLowerCase());
                    if (mappedTag) {
                        orderTags.add(mappedTag);
                    }
                }
            }
        }

        return Array.from(orderTags);
    }

    /**
     * Get all unique product tags across all products for an account.
     * Used to populate the settings UI with available tags to map.
     */
    static async getAllProductTags(accountId: string): Promise<string[]> {
        const products = await prisma.wooProduct.findMany({
            where: { accountId },
            select: { rawData: true }
        });

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

        return Array.from(tagSet).sort();
    }
}

