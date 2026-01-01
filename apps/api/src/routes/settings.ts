import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { stores, storeCredentials } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export async function settingsRoutes(fastify: FastifyInstance) {
    fastify.addHook('preHandler', requireAuth);

    // GET Settings
    fastify.get('/', async (req: any, reply) => {
        // Assume context is user's default store or specified via header? 
        // For now, use user.defaultStoreId aka active account context.
        const storeId = req.user.defaultStoreId;

        if (!storeId) {
            return reply.status(400).send({ error: "No store context associated with user." });
        }

        const store = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
        if (!store.length) return reply.status(404).send({ error: "Store not found" });

        const creds = await db.select().from(storeCredentials).where(eq(storeCredentials.storeId, storeId)).limit(1);

        // Merge JSON settings with Credentials
        const combined = {
            ...store[0].settings as object,
            storeUrl: store[0].url,
            consumerKey: creds[0]?.consumerKey || '',
            consumerSecret: creds[0]?.consumerSecret || '', // Should be decrypted if encryption was implemented
        };

        return combined;
    });

    // UPDATE Settings
    fastify.post('/', async (req: any, reply) => {
        const storeId = req.user.defaultStoreId;
        const newSettings = req.body;

        if (!storeId) {
            return reply.status(400).send({ error: "No store context." });
        }

        // Extract Standard Columns vs JSONB
        const { storeUrl, consumerKey, consumerSecret, ...rest } = newSettings;

        // 1. Update Core Store Data
        if (storeUrl) {
            await db.update(stores)
                .set({ url: storeUrl, settings: rest }) // Overwrite or merge logic? JSONB overwrites top level.
                // ideally we merge deep, but for now replace is simpler for settings forms.
                .where(eq(stores.id, storeId));
        } else {
            await db.update(stores)
                .set({ settings: rest })
                .where(eq(stores.id, storeId));
        }

        // 2. Update Credentials if provided
        if (consumerKey && consumerSecret) {
            const existing = await db.select().from(storeCredentials).where(eq(storeCredentials.storeId, storeId)).limit(1);
            if (existing.length) {
                await db.update(storeCredentials).set({
                    consumerKey,
                    consumerSecret // TODO: Encrypt
                }).where(eq(storeCredentials.storeId, storeId));
            } else {
                await db.insert(storeCredentials).values({
                    storeId,
                    consumerKey,
                    consumerSecret
                });
            }
        }

        return { success: true };
    });
}
