import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { users, stores, products, orders } from '../db/schema.js';

export async function adminRoutes(fastify: FastifyInstance) {
    fastify.addHook('preHandler', requireAuth);

    // Real System Stats
    fastify.get('/stats', async (req, reply) => {
        try {
            // Database Stats
            // Parallel count queries
            const [usersCount, storesCount, productsCount, ordersCount] = await Promise.all([
                db.select({ count: sql<number>`count(*)` }).from(users),
                db.select({ count: sql<number>`count(*)` }).from(stores),
                db.select({ count: sql<number>`count(*)` }).from(products),
                db.select({ count: sql<number>`count(*)` }).from(orders)
            ]);

            const dbStats = {
                users: Number(usersCount[0].count),
                stores: Number(storesCount[0].count),
                data_rows: Number(productsCount[0].count) + Number(ordersCount[0].count)
            };

            // System Stats
            const mem = process.memoryUsage();
            const sys = {
                uptime: process.uptime(),
                memory: {
                    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
                    rss: Math.round(mem.rss / 1024 / 1024)
                },
                load: [0, 0, 0] // Mock load for cross-platform safety (os.loadavg() can be flaky in some docker envs)
            };

            return {
                status: 'ok',
                db: dbStats,
                system: sys,
                health: '98%' // Placeholder for now, could be derived
            };
        } catch (e: any) {
            req.log.error(e);
            return reply.status(500).send({ error: e.message });
        }
    });
}
