/**
 * Hot Tier Cache - Dexie.js Client-Side Database
 * 
 * Mirrors recent orders, products, and customers in IndexedDB
 * for instant offline-capable search.
 */

import Dexie, { Table } from 'dexie';

interface CachedOrder {
    id: string;
    wooId: number;
    accountId: string;
    data: unknown;
    syncedAt: number;
}

export interface CachedProduct {
    id: string;
    wooId: number;
    accountId: string;
    name: string;
    sku: string;
    data: unknown;
    syncedAt: number;
}

interface CachedCustomer {
    id: string;
    wooId: number;
    accountId: string;
    email: string;
    name: string;
    data: unknown;
    syncedAt: number;
}

interface CacheMeta {
    key: string;
    value: unknown;
}

class HotTierDB extends Dexie {
    orders!: Table<CachedOrder>;
    products!: Table<CachedProduct>;
    customers!: Table<CachedCustomer>;
    meta!: Table<CacheMeta>;

    constructor() {
        super('OverseekHotTier');

        this.version(1).stores({
            orders: 'id, wooId, accountId, syncedAt',
            products: 'id, wooId, accountId, name, sku, syncedAt',
            customers: 'id, wooId, accountId, email, name, syncedAt',
            meta: 'key'
        });
    }
}

// Singleton instance
const hotTierDB = new HotTierDB();

/**
 * Get the last sync timestamp for a table
 */
async function getLastSyncTime(table: 'orders' | 'products' | 'customers', accountId: string): Promise<number | null> {
    const key = `lastSync:${table}:${accountId}`;
    const meta = await hotTierDB.meta.get(key);
    return typeof meta?.value === 'number' ? meta.value : null;
}

/**
 * Clear all cache for an account
 */
export async function clearAccountCache(accountId: string): Promise<void> {
    await hotTierDB.orders.where('accountId').equals(accountId).delete();
    await hotTierDB.products.where('accountId').equals(accountId).delete();
    await hotTierDB.customers.where('accountId').equals(accountId).delete();

    // Clear meta keys for this account
    const metaKeys = await hotTierDB.meta
        .filter(m => m.key.includes(accountId))
        .toArray();

    await hotTierDB.meta.bulkDelete(metaKeys.map(m => m.key));
}

/**
 * Search products locally with relevance-based ranking.
 * Uses cursor-based filtering to avoid loading all products into JS memory.
 */
export async function searchProductsLocal(accountId: string, query: string): Promise<CachedProduct[]> {
    const lowerQuery = query.toLowerCase();

    /** Why: Scoring requires comparing each product, but we filter via Dexie's
     *  indexed `accountId` query first, then apply the JS filter in a single pass
     *  without materializing the entire table into an Array. */
    const scored: { product: CachedProduct; score: number }[] = [];

    await hotTierDB.products
        .where('accountId').equals(accountId)
        .each((p: CachedProduct) => {
            const nameLower = p.name.toLowerCase();
            const skuLower = (p.sku || '').toLowerCase();

            let score = 0;

            if (nameLower === lowerQuery) score = 100;
            else if (nameLower.startsWith(lowerQuery)) score = 80;
            else if (skuLower === lowerQuery) score = 75;
            else if (skuLower.startsWith(lowerQuery)) score = 60;
            else if (nameLower.includes(lowerQuery)) score = 40;
            else if (skuLower.includes(lowerQuery)) score = 20;

            if (score > 0) {
                scored.push({ product: p, score });
            }
        });

    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
        .map(item => item.product);
}

/**
 * Search customers locally
 */
/**
 * Get cache stats
 */
export async function getCacheStats(accountId: string): Promise<{
    orders: number;
    products: number;
    customers: number;
    lastSync: { orders: number | null; products: number | null; customers: number | null };
}> {
    const [ordersCount, productsCount, customersCount] = await Promise.all([
        hotTierDB.orders.where('accountId').equals(accountId).count(),
        hotTierDB.products.where('accountId').equals(accountId).count(),
        hotTierDB.customers.where('accountId').equals(accountId).count()
    ]);

    const [ordersSync, productsSync, customersSync] = await Promise.all([
        getLastSyncTime('orders', accountId),
        getLastSyncTime('products', accountId),
        getLastSyncTime('customers', accountId)
    ]);

    return {
        orders: ordersCount,
        products: productsCount,
        customers: customersCount,
        lastSync: {
            orders: ordersSync,
            products: productsSync,
            customers: customersSync
        }
    };
}
