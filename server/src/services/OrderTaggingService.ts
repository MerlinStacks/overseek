import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

/**
 * Tag mapping configuration stored in Account.orderTagMappings
 */
export interface TagMapping {
    productTag?: string;  // Legacy single tag from WooCommerce product
    productTags?: string[]; // New multi-tag mapping support
    orderTag: string;    // The tag name to apply to orders
    enabled: boolean;    // Whether this mapping is active
    color?: string;      // Optional hex color for display (e.g. "#3B82F6")
}

interface NormalizedTagMapping {
    productTags: string[];
    orderTag: string;
    enabled: boolean;
    color?: string;
}

/**
 * Service for computing order tags from product tags using configurable mappings.
 * Only applies tags that have an enabled mapping in the account settings.
 */
export class OrderTaggingService {
    private static normalizeMappings(mappings: TagMapping[]): NormalizedTagMapping[] {
        return mappings
            .map((mapping) => {
                const tagsFromArray = Array.isArray(mapping.productTags)
                    ? mapping.productTags
                    : [];
                const legacyTag = typeof mapping.productTag === 'string' ? [mapping.productTag] : [];
                const normalizedTags = Array.from(
                    new Set(
                        [...tagsFromArray, ...legacyTag]
                            .map((tag) => String(tag || '').trim())
                            .filter(Boolean)
                            .map((tag) => tag.toLowerCase())
                    )
                );

                return {
                    productTags: normalizedTags,
                    orderTag: String(mapping.orderTag || '').trim(),
                    enabled: Boolean(mapping.enabled),
                    color: mapping.color
                };
            })
            .filter((mapping) => mapping.productTags.length > 0 && mapping.orderTag.length > 0);
    }

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
        const normalizedMappings = this.normalizeMappings(mappings);
        // Prisma 7 requires proper JSON serialization for Json fields
        const sanitizedMappings = JSON.parse(JSON.stringify(normalizedMappings));

        await prisma.account.update({
            where: { id: accountId },
            data: { orderTagMappings: sanitizedMappings }
        });
        Logger.info('Tag mappings saved', { accountId, count: normalizedMappings.length });
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
        const enabledMappings = this.normalizeMappings(mappings).filter(m => m.enabled);

        // If no mappings configured, return empty map (all orders have empty tags)
        if (enabledMappings.length === 0) return result;

        // Build lookup: productTag -> orderTag
        const mappingLookup = new Map<string, string>();
        for (const m of enabledMappings) {
            for (const productTag of m.productTags) {
                mappingLookup.set(productTag, m.orderTag);
            }
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
     * @param knownMappings - Optional optimization: pass already loaded mappings to avoid DB lookup
     * @returns Array of mapped order tag names
     */
    static async extractTagsFromOrder(accountId: string, rawOrderData: any, knownMappings?: TagMapping[]): Promise<string[]> {
        const lineItems = rawOrderData?.line_items || [];
        if (lineItems.length === 0) return [];

        // Get tag mappings for this account
        const mappings = knownMappings || await this.getTagMappings(accountId);
        const enabledMappings = this.normalizeMappings(mappings).filter(m => m.enabled);

        // If no mappings configured, return empty (user must configure first)
        if (enabledMappings.length === 0) return [];

        // Build lookup: productTag -> orderTag
        const mappingLookup = new Map<string, string>();
        for (const m of enabledMappings) {
            for (const productTag of m.productTags) {
                mappingLookup.set(productTag, m.orderTag);
            }
        }

        // Get unique product IDs from line items
        const rawIds = lineItems
            .map((item: any) => item.product_id)
            .filter((id: number) => id && id > 0);
        const productIds: number[] = Array.from(new Set(rawIds));

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
     * Limited to 5000 products to prevent memory issues on large catalogs.
     */
    static async getAllProductTags(accountId: string): Promise<string[]> {
        const MAX_PRODUCTS = 5000;
        const products = await prisma.wooProduct.findMany({
            where: { accountId },
            select: { rawData: true },
            take: MAX_PRODUCTS
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
