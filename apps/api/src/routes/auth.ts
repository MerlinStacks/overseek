import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { users, stores } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { verifyPassword, hashPassword } from '../auth/utils.js';
import { createSession, destroySession } from '../auth/session.js';
import { requireAuth } from '../middleware/auth.js';

export async function authRoutes(fastify: FastifyInstance) {
    // ... (rest of routes)

    fastify.get('/me', { preHandler: requireAuth }, async (req: any, reply) => {
        // req.user is guaranteed by requireAuth
        if (!req.user) {
            // Should be unreachable if middleware works
            return reply.status(401).send({ error: 'Not authenticated (Unexpected)' });
        }

        // Auto-Promote if system is headless (Safety Net)
        if (!req.user.isSuperAdmin) {
            const superAdminCountResult = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.isSuperAdmin, true));
            if (Number(superAdminCountResult[0].count) === 0) {
                await db.update(users).set({ isSuperAdmin: true }).where(eq(users.id, req.user.id));
                req.user.isSuperAdmin = true;
            }
        }
        return {
            id: req.user.id,
            email: req.user.email,
            fullName: req.user.fullName,
            storeId: req.user.defaultStoreId,
            isSuperAdmin: req.user.isSuperAdmin // Expose this
        };
    });
}
