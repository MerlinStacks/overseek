import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { products, orders, customers, reviews, coupons } from '../db/schema.js';
import { eq, and, gt, desc } from 'drizzle-orm';

const TABLES: Record<string, any> = {
    products,
    orders,
    customers,
    reviews,
    coupons
};

export async function dbRoutes(fastify: FastifyInstance) {
    fastify.addHook('preHandler', requireAuth);

    fastify.get('/:entity', async (req: any, reply) => {
        const { entity } = req.params;
        const { page = 1, limit = 500, modified_after } = req.query;

        const storeId = req.user.defaultStoreId;
        if (!storeId) {
            return reply.status(400).send({ error: "No active store context" });
        }

        const table = TABLES[entity];
        if (!table) {
            return reply.status(404).send({ error: "Unknown entity" });
        }

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const offset = (pageNum - 1) * limitNum;

        // Build Query
        const conditions = [eq(table.accountId, storeId)];

        if (modified_after) {
            conditions.push(gt(table.syncedAt, new Date(modified_after as string)));
        }

        try {
            // Count Total
            // Note: Drizzle doesn't have a simple count() with where() in one go for all adapters yet, 
            // but for simplicity in this "sync" context, we might skip total or do a separate count.
            // Let's do a simple count for pagination metadata.
            // const countRes = await db.select({ count: sql<number>`count(*)` }).from(table).where(and(...conditions));
            // const total = Number(countRes[0].count);

            // Actually, for sync "scrolling", we just need to know if there's more.
            // But the worker expects 'totalPages'.

            const data = await db.select()
                .from(table)
                .where(and(...conditions))
                .limit(limitNum)
                .offset(offset)
                .orderBy(desc(table.syncedAt)); // Sync most recent first? Or oldest? Usually generic sync is agnostic.

            // Quick total estimate or fetch all?
            // Let's just return what we have. If data.length < limit, we are done.
            // But the worker logic relies on `totalPages`.
            // Let's optimize: just return a high number if full, or page if not.
            const totalPages = data.length < limitNum ? pageNum : pageNum + 1; // logical guess

            // Unwrap the JSON 'data' column which contains the actual WooCommerce fields
            const unpacked = data.map(row => ({
                ...row.data as object,
                // We overwrite with our internal Sync Metadata if needed
                _synced_at: row.syncedAt
            }));

            return {
                data: unpacked,
                page: pageNum,
                totalPages: totalPages
            };

        } catch (e: any) {
            req.log.error(e);
            return reply.status(500).send({ error: e.message });
        }
    });
}
