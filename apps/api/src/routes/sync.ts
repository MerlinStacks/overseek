import { FastifyInstance } from 'fastify';
import { startSync, getStatus } from '../sync/index.js';
import { checkLiveOrders } from '../sync/live.js';
import { requireAuth } from '../middleware/auth.js';

export async function syncRoutes(fastify: FastifyInstance) {
    fastify.addHook('preHandler', requireAuth);

    fastify.post('/start', async (req: any, reply) => {
        const { storeUrl, consumerKey, consumerSecret, authMethod, accountId, options } = req.body;

        // Validation could be added here (Zod)

        // Async Start
        startSync({ storeUrl, consumerKey, consumerSecret, authMethod, accountId, options });

        return { status: 'started' };
    });

    fastify.get('/status', async (req, reply) => {
        return getStatus();
    });

    fastify.post('/latest-orders', async (req: any, reply) => {
        const { storeId, keys } = req.body;

        // Use user's ID as storeId if not provided (fallback logic)
        // For now, trust the body, but ensure authenticated (preHandler does this)
        const effectiveStoreId = storeId || req.user?.defaultStoreId;

        if (!effectiveStoreId) {
            return reply.status(400).send({ error: "Store ID required" });
        }

        const orders = await checkLiveOrders({
            storeId: effectiveStoreId,
            fallbackKeys: keys
        });

        return { orders };
    });

}
