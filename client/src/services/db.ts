/**
 * Hot Tier Cache - Dexie.js Client-Side Database
 * 
 * Mirrors recent orders, products, and customers in IndexedDB
 * for instant offline-capable search.
 */

import Dexie, { Table } from 'dexie';

export interface CachedOrder {
    id: string;
    wooId: number;
    accountId: string;
    data: any;
    syncedAt: number;
}

export interface CachedProduct {
    id: string;
    wooId: number;
    accountId: string;
    name: string;
    sku: string;
    data: any;
    syncedAt: number;
}

export interface CachedCustomer {
    id: string;
    wooId: number;
    accountId: string;
    email: string;
    name: string;
    data: any;
    syncedAt: number;
}

export interface CacheMeta {
    key: string;
    value: any;
}

export class HotTierDB extends Dexie {
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
export const hotTierDB = new HotTierDB();

// Cache configuration
const CACHE_CONFIG = {
    orders: { maxItems: 1000, maxAgeMs: 24 * 60 * 60 * 1000 }, // 24 hours
    products: { maxItems: 5000, maxAgeMs: 7 * 24 * 60 * 60 * 1000 }, // 7 days
    customers: { maxItems: 1000, maxAgeMs: 24 * 60 * 60 * 1000 } // 24 hours
};

/**
 * Get the last sync timestamp for a table
 */
export async function getLastSyncTime(table: 'orders' | 'products' | 'customers', accountId: string): Promise<number | null> {
    const key = `lastSync:${table}:${accountId}`;
    const meta = await hotTierDB.meta.get(key);
    return meta?.value || null;
}

/**
 * Update the last sync timestamp for a table
 */
export async function setLastSyncTime(table: 'orders' | 'products' | 'customers', accountId: string): Promise<void> {
    const key = `lastSync:${table}:${accountId}`;
    await hotTierDB.meta.put({ key, value: Date.now() });
}

/**
 * Prune old entries from a table
 */
export async function pruneTable(table: 'orders' | 'products' | 'customers', accountId: string): Promise<number> {
    const config = CACHE_CONFIG[table];
    const cutoff = Date.now() - config.maxAgeMs;

    // Delete old entries
    const deletedByAge = await hotTierDB[table]
        .where('accountId').equals(accountId)
        .and(item => item.syncedAt < cutoff)
        .delete();

    // Count remaining
    const remaining = await hotTierDB[table]
        .where('accountId').equals(accountId)
        .count();

    // If still over limit, delete oldest
    if (remaining > config.maxItems) {
        const toDelete = remaining - config.maxItems;
        const oldest = await hotTierDB[table]
            .where('accountId').equals(accountId)
            .sortBy('syncedAt');

        const idsToDelete = oldest.slice(0, toDelete).map(item => item.id);
        await hotTierDB[table].bulkDelete(idsToDelete);

        return deletedByAge + toDelete;
    }

    return deletedByAge;
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
export async function searchCustomersLocal(accountId: string, query: string): Promise<CachedCustomer[]> {
    const lowerQuery = query.toLowerCase();

    return hotTierDB.customers
        .where('accountId').equals(accountId)
        .filter((c: CachedCustomer) =>
            c.name.toLowerCase().includes(lowerQuery) ||
            Boolean(c.email && c.email.toLowerCase().includes(lowerQuery))
        )
        .limit(50)
        .toArray();
}

/**
 * Search orders locally by ID
 */
export async function searchOrdersLocal(accountId: string, query: string): Promise<CachedOrder[]> {
    // If query looks like a number, search by wooId
    const numericQuery = parseInt(query, 10);

    if (!isNaN(numericQuery)) {
        return hotTierDB.orders
            .where('accountId').equals(accountId)
            .and(o => o.wooId === numericQuery || o.wooId.toString().includes(query))
            .limit(20)
            .toArray();
    }

    return [];
}

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

export default hotTierDB;
