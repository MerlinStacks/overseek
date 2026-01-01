import { sql, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { syncState, products, orders, reviews, customers, coupons } from '../db/schema.js';
import { AxiosInstance } from 'axios';

// Map string table names to Drizzle definitions
const TABLES: Record<string, any> = {
    products,
    orders,
    reviews,
    customers,
    coupons
};

export type EntityType = keyof typeof TABLES;

export const saveBatch = async (entity: EntityType, accountId: number, items: any[]) => {
    const table = TABLES[entity];
    if (!table) throw new Error(`Unknown entity ${entity}`);

    if (items.length === 0) return;

    // Transform items for insertion
    const values = items.map(item => ({
        accountId,
        id: item.id,
        data: item, // Drizzle handles JSON stringification
        syncedAt: new Date()
    }));

    // Upsert
    await db.insert(table)
        .values(values)
        .onConflictDoUpdate({
            target: [table.accountId, table.id],
            set: {
                data: sql`excluded.data`,
                syncedAt: new Date()
            }
        });
};

export const syncEntity = async (
    api: AxiosInstance,
    entity: EntityType,
    accountId: number,
    onProgress: (page: number, total: number) => void,
    lastSynced?: Date
) => {
    const endpoints: Record<string, string> = {
        products: '/products',
        orders: '/orders',
        reviews: '/products/reviews',
        customers: '/customers',
        coupons: '/coupons'
    };

    const endpoint = endpoints[entity];
    let page = 1;
    let totalPages = 1;

    do {
        const params: any = { page, per_page: 50 };
        if (entity === 'customers') params.role = 'all';
        if (lastSynced) {
            params.modified_after = lastSynced.toISOString();
        }

        const res = await api.get(endpoint, { params });
        const items = res.data;
        totalPages = parseInt(res.headers['x-wp-totalpages'] || '1', 10);

        if (onProgress) onProgress(page, totalPages);

        if (items.length > 0) {
            // Handle Variations logic for Products
            if (entity === 'products') {
                for (const p of items) {
                    if (p.type === 'variable') {
                        try {
                            const vRes = await api.get(`/products/${p.id}/variations`, { params: { per_page: 100 } });
                            const variations = vRes.data.map((v: any) => ({ ...v, type: 'variation', parent_id: p.id }));
                            // We save variations as separate rows? 
                            // The original logic pushed them to `processedItems`.
                            // They have IDs, so they fit the schema.
                            items.push(...variations);
                        } catch (e) {
                            console.warn(`Failed variations for #${p.id}`);
                        }
                    }
                }
            }
            await saveBatch(entity, accountId, items);
        }
        page++;
    } while (page <= totalPages);
};

export const updateSyncState = async (accountId: number, entity: string, time: Date) => {
    await db.insert(syncState)
        .values({ accountId, entity, lastSyncedAt: time })
        .onConflictDoUpdate({
            target: [syncState.accountId, syncState.entity],
            set: { lastSyncedAt: time }
        });
};

export const getSyncState = async (accountId: number, entity: string) => {
    const res = await db.select().from(syncState)
        .where(sql`${syncState.accountId} = ${accountId} AND ${syncState.entity} = ${entity}`)
        .limit(1);
    return res[0]?.lastSyncedAt || null;
};
