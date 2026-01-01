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

        const settingsObj = store[0].settings as Record<string, any> || {};

        // Merge JSON settings with Credentials
        const combined = {
            ...settingsObj,
            storeUrl: store[0].url,
            // Fallback to JSON settings if Credentials table entry is missing or empty
            consumerKey: creds[0]?.consumerKey || settingsObj.consumerKey || '',
            consumerSecret: creds[0]?.consumerSecret || settingsObj.consumerSecret || '', // Should be decrypted if encryption was implemented
        };

        return combined;
    });

    // UPDATE Settings
    fastify.post('/', async (req: any, reply) => {
        const storeId = req.user.defaultStoreId;
        const newSettings = req.body;

        console.log(`[Settings] Update request for Store ${storeId}:`, newSettings);

        if (!storeId) {
            console.error('[Settings] Error: No store context for user', req.user.id);
            return reply.status(400).send({ error: "No store context." });
        }

        // Extract Standard Columns vs JSONB
        const { storeUrl, consumerKey, consumerSecret, ...rest } = newSettings;

        try {
            // 1. Get existing settings to merge
            const existingStore = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
            if (!existingStore.length) return reply.status(404).send({ error: "Store not found" });

            const currentSettings = existingStore[0].settings || {};
            const mergedSettings = { ...currentSettings as object, ...rest };

            // 2. Update Core Store Data
            if (storeUrl) {
                await db.update(stores)
                    .set({ url: storeUrl, settings: mergedSettings })
                    .where(eq(stores.id, storeId));
            } else {
                await db.update(stores)
                    .set({ settings: mergedSettings })
                    .where(eq(stores.id, storeId));
            }

            // 3. Update Credentials if provided
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

            console.log(`[Settings] Successfully updated store ${storeId}`);
            return { success: true };
        } catch (err) {
            console.error('[Settings] Update failed:', err);
            return reply.status(500).send({ error: "Failed to update settings" });
        }
    });
}
