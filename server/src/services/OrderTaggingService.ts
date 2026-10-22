import { z } from 'zod';
import { prisma } from '../utils/prisma';
const id = z.string().trim().min(1).max(200), name = z.string().trim().min(1).max(100);
const mappingSchema = z.object({ productTag: name.optional(), productTags: z.array(name).max(100).optional(), orderTag: name, enabled: z.boolean(), color: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional() }).strict().refine(row => !!row.productTag || !!row.productTags?.length, 'At least one product tag required');
export type TagMapping = z.infer<typeof mappingSchema>;
const schema = z.array(mappingSchema).max(500);
export const tagMappingsWriteSchema = z.object({ mappings: schema, version: z.string().datetime() }).strict();
const fail = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });
export function validateOrderTags(value: unknown): string[] {
    return z.array(name).max(100).parse(value);
}
export function mergeOrderTags(...groups: unknown[]): string[] {
    const result = new Map<string, string>();
    for (const group of groups) for (const tag of validateOrderTags(group)) if (!result.has(tag.toLowerCase())) result.set(tag.toLowerCase(), tag);
    if (result.size > 100) throw fail('Combined order tags exceed limit');
    return [...result.values()];
}
function normalize(value: unknown): TagMapping[] {
    return schema.parse(value).map(row => ({ orderTag: row.orderTag, enabled: row.enabled, ...(row.color ? { color: row.color } : {}), productTags: [...new Map([...(row.productTags || []), ...(row.productTag ? [row.productTag] : [])].map(tag => [tag.toLowerCase(), tag])).values()] }));
}
export class OrderTaggingService {
    static async getTagMappingSnapshot(accountId: string) {
        id.parse(accountId);
        const account = await prisma.account.findUnique({ where: { id: accountId }, select: { orderTagMappings: true, updatedAt: true } });
        if (!account) throw fail('Account unavailable', 404);
        return { mappings: normalize(account.orderTagMappings ?? []), version: account.updatedAt.toISOString() };
    }
    static async getTagMappings(accountId: string): Promise<TagMapping[]> {
        // Internal readers still use the validated array; no malformed-config-as-empty fallback.
        id.parse(accountId);
        const account = await prisma.account.findUnique({ where: { id: accountId }, select: { orderTagMappings: true } });
        if (!account) throw fail('Account unavailable', 404); return normalize(account.orderTagMappings ?? []);
    }
    static async saveTagMappings(accountId: string, input: unknown, userId: string) {
        id.parse(accountId); id.parse(userId);
        const { PermissionService } = await import('./PermissionService');
        if (!await PermissionService.hasPermission(userId, accountId, 'manage_order_tag_mappings')) throw fail('Tag mapping management permission required', 403);
        const { version, mappings } = tagMappingsWriteSchema.parse(input), normalized = normalize(mappings);
        const updatedAt = new Date(Math.max(Date.now(), Date.parse(version) + 1));
        const result = await prisma.account.updateMany({ where: { id: accountId, updatedAt: new Date(version) }, data: { orderTagMappings: normalized, updatedAt } });
        if (result.count !== 1) throw fail('Account settings changed; reload mappings');
        return { success: true, version: updatedAt.toISOString(), mappings: normalized };
    }
    static async extractTagsForOrders(accountId: string, orders: unknown[], knownMappings?: TagMapping[]): Promise<Map<number, string[]>> {
        id.parse(accountId);
        const parsed = z.array(z.object({ id: z.number().int().positive(), line_items: z.array(z.object({ product_id: z.number().int().nonnegative() }).passthrough()).max(200) }).passthrough()).max(200).parse(orders);
        if (!parsed.length) return new Map();
        if (new Set(parsed.map(order => order.id)).size !== parsed.length) throw fail('Duplicate order identities');
        const mappings = normalize(knownMappings ?? await this.getTagMappings(accountId)).filter(row => row.enabled);
        const result = new Map<number, string[]>(parsed.map(order => [order.id, []]));
        if (!mappings.length) return result;
        // One input tag may deliberately map to multiple output tags; union, never last-wins.
        const lookup = new Map<string, Set<string>>();
        for (const mapping of mappings) for (const tag of mapping.productTags!) { const targets = lookup.get(tag.toLowerCase()) || new Set<string>(); targets.add(mapping.orderTag); lookup.set(tag.toLowerCase(), targets); }
        const ids = [...new Set(parsed.flatMap(order => order.line_items.map(item => item.product_id).filter(value => value > 0)))];
        if (ids.length > 2000) throw fail('Product coverage limit exceeded');
        if (!ids.length) return result;
        const products = await prisma.wooProduct.findMany({ where: { accountId, wooId: { in: ids } }, select: { wooId: true, rawData: true }, orderBy: { wooId: 'asc' }, take: 2001 });
        if (products.length !== ids.length || new Set(products.map(row => row.wooId)).size !== ids.length) throw fail('Product tag coverage unavailable; existing tags must be preserved');
        const productsById = new Map(products.map(product => {
            const raw = z.object({ tags: z.array(z.object({ name }).passthrough()).max(500) }).passthrough().parse(product.rawData);
            return [product.wooId, raw.tags.flatMap(tag => [...(lookup.get(tag.name.toLowerCase()) || [])])];
        }));
        for (const order of parsed) result.set(order.id, mergeOrderTags(...order.line_items.filter(item => item.product_id > 0).map(item => productsById.get(item.product_id) || [])));
        return result;
    }
    static async extractTagsFromOrder(accountId: string, rawOrderData: unknown, knownMappings?: TagMapping[]) {
        const order = z.object({ id: z.number().int().positive() }).passthrough().parse(rawOrderData);
        return (await this.extractTagsForOrders(accountId, [order], knownMappings)).get(order.id)!;
    }
    static async getAllProductTags(accountId: string) {
        id.parse(accountId);
        const products = await prisma.wooProduct.findMany({ where: { accountId }, select: { rawData: true }, orderBy: { id: 'asc' }, take: 5001 });
        const tags = new Set<string>();
        for (const product of products.slice(0, 5000)) {
            const raw = z.object({ tags: z.array(z.object({ name }).passthrough()).max(500) }).passthrough().parse(product.rawData);
            for (const tag of raw.tags) tags.add(tag.name);
            if (tags.size > 10000) throw fail('Catalog tag limit exceeded');
        }
        return { tags: [...tags].sort(), coverage: { complete: products.length <= 5000, productLimit: 5000, basis: 'local-catalog-sample' } };
    }
}
