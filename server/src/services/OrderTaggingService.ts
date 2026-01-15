import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

/**
 * Tag mapping configuration stored in Account.orderTagMappings
 */
export interface TagMapping {
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

