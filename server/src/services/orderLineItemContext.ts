import { prisma } from '../utils/prisma';

/** Shared local enrichment for exact email orders and automation conditions. */
export async function enrichOrderLineItemPermalinks(accountId: string, order: Record<string, any>): Promise<Record<string, any>> {
    const field = Array.isArray(order.line_items) ? 'line_items' : Array.isArray(order.lineItems) ? 'lineItems' : 'items';
    const items: any[] = Array.isArray(order[field]) ? order[field] : [];
    const productIds = Array.from(new Set(items.map(item => Number(item?.product_id || item?.productId))
        .filter(id => Number.isFinite(id) && id > 0)));
    if (!productIds.length) return order;
    const products = await prisma.wooProduct.findMany({
        where: { accountId, wooId: { in: productIds } },
        select: { wooId: true, permalink: true, rawData: true }
    });
    const byId = new Map(products.map(product => [product.wooId, product]));
    return { ...order, [field]: items.map(item => {
        const product = byId.get(Number(item?.product_id || item?.productId));
        if (!product) return item;
        const raw = product.rawData as Record<string, any> | null;
        const categoryIds = (Array.isArray(raw?.categories) ? raw.categories : [])
            .map((category: any) => category?.id ?? category?.term_id)
            .filter((id: unknown) => id !== undefined && id !== null && id !== '').map(String);
        const permalink = product.permalink;
        const hasPermalink = item.permalink || item.product_permalink || item.productUrl || item.product_url;
        return {
            ...item,
            ...(!hasPermalink && permalink ? { permalink, product_permalink: permalink, productUrl: permalink, product_url: permalink } : {}),
            ...(!(Array.isArray(item.categoryIds) && item.categoryIds.length) && categoryIds.length ? { categoryIds } : {})
        };
    }) };
}
