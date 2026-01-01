import { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { users, sessions, analytics_events, userRoles } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export async function complianceRoutes(fastify: FastifyInstance) {
    fastify.addHook('preHandler', requireAuth);

    // DSR: Right to be Forgotten (Nuke)
    fastify.post('/nuke', async (req: any, reply) => {
        const userId = req.user.id;

        if (!userId) {
            return reply.status(400).send({ error: "User context required" });
        }

        try {
            // 1. Anonymize Analytics (Keep stats, remove identity)
            await db.update(analytics_events)
                .set({ userId: null, sessionId: null })
                .where(eq(analytics_events.userId, userId));

            // 2. Delete Sessions
            await db.delete(sessions).where(eq(sessions.userId, userId));

            // 3. Delete Roles Association
            await db.delete(userRoles).where(eq(userRoles.userId, userId));

            // 4. Delete Identity
            // Note: This might fail if other foreign keys (like orders, stores) reference it without CASCADE.
            // For now, assuming basic cleanup. 
            await db.delete(users).where(eq(users.id, userId));

            return { success: true, message: "User identity nuked." };

        } catch (e: any) {
            req.log.error(e);
            return reply.status(500).send({ error: "Failed to process DSR request. Data may be partially deleted." });
        }
    });

    // TODO: "Export Data" (Right to Access) could go here too.
}
