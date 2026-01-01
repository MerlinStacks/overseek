import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';

export async function adminRoutes(fastify: FastifyInstance) {
    fastify.addHook('preHandler', requireAuth);

    // Placeholder for legacy admin routes
    fastify.get('/stats', async (req, reply) => {
        // Example Drizzle query
        // const stats = await db.execute(sql`SELECT count(*) FROM orders`);
        return { status: 'ok', msg: 'Admin Stats Placeholder' };
    });
}
