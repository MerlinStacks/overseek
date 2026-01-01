import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { ad_integrations, ad_campaigns } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

export async function marketingRoutes(fastify: FastifyInstance) {
    // Webhook for Ad Spend (Simulated for now)
    // Defined BEFORE auth hook to remain public
    fastify.post('/webhook/ads', async (req: any, reply) => {
        // This would verify signature from Meta/Google
        // For now, accept internal updates
        const { campaigns } = req.body; // Array of { id, name, spend, roas... }

        // Context Issue: Without Auth, we don't have `req.user.defaultStoreId`.
        // Real webhooks send IDs we need to match.
        // For simulation, let's look up store by some ID in payload or trusted source.
        const { storeId: payloadStoreId } = req.body; // Expect payload to carry context

        if (!campaigns || !Array.isArray(campaigns) || !payloadStoreId) return { success: false };

        for (const camp of campaigns) {
            const platform = camp.platform || 'meta'; // Default

            await db.insert(ad_campaigns).values({
                id: camp.id,
                storeId: payloadStoreId,
                platform,
                name: camp.name,
                status: camp.status || 'active',
                spend: camp.spend,
                roas: camp.roas,
                impressions: camp.impressions,
                clicks: camp.clicks,
                syncedAt: new Date()
            }).onConflictDoUpdate({
                target: ad_campaigns.id,
                set: {
                    spend: camp.spend,
                    roas: camp.roas,
                    syncedAt: new Date()
                }
            });
        }

        return { success: true };
    });

    fastify.addHook('preHandler', requireAuth);

    // GET /api/marketing/integrations
    fastify.get('/integrations', async (req: any, reply) => {
        const storeId = req.user.defaultStoreId; // Assuming context
        if (!storeId) return reply.status(400).send({ error: "Store context missing" });

        const integrations = await db.select().from(ad_integrations).where(eq(ad_integrations.storeId, storeId));

        // Hide tokens
        return integrations.map(i => ({
            platform: i.platform,
            status: i.status,
            pixelId: i.pixelId,
            updatedAt: i.updatedAt
        }));
    });

    // POST /api/marketing/integrations
    fastify.post('/integrations', async (req: any, reply) => {
        const { platform, accessToken, pixelId, status } = req.body;
        const storeId = req.user.defaultStoreId;

        if (!storeId || !platform) return reply.status(400).send({ error: "Missing fields" });

        // Upsert
        const existing = await db.select().from(ad_integrations)
            .where(and(eq(ad_integrations.storeId, storeId), eq(ad_integrations.platform, platform)))
            .limit(1);

        if (existing.length) {
            await db.update(ad_integrations).set({
                accessToken: accessToken || existing[0].accessToken,
                pixelId: pixelId || existing[0].pixelId,
                status: status || existing[0].status,
                updatedAt: new Date()
            }).where(eq(ad_integrations.id, existing[0].id));
        } else {
            await db.insert(ad_integrations).values({
                storeId,
                platform,
                accessToken,
                pixelId,
                status: status || 'active'
            });
        }

        return { success: true };
    });


}
