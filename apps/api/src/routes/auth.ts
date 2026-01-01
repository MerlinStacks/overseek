import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { users, stores } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { verifyPassword, hashPassword } from '../auth/utils.js';
import { createSession, destroySession } from '../auth/session.js';

export async function authRoutes(fastify: FastifyInstance) {
    fastify.post('/register', async (req: any, reply) => {
        const { email, password, fullName, storeName } = req.body;

        if (!email || !password) {
            return reply.status(400).send({ error: 'Email and password are required' });
        }

        // Check if user exists
        const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (existing.length > 0) {
            return reply.status(400).send({ error: 'User already exists' });
        }

        // Check for super admin (first user or no existing super admins)
        const userCountResult = await db.select({ count: sql<number>`count(*)` }).from(users);
        const superAdminCountResult = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.isSuperAdmin, true));

        const isFirstUser = Number(userCountResult[0].count) === 0;
        const noSuperAdmins = Number(superAdminCountResult[0].count) === 0;
        const shouldBeSuperAdmin = isFirstUser || noSuperAdmins;

        // Hash Password
        const passwordHash = await hashPassword(password);

        // Create Store if provided
        let defaultStoreId: number | null = null;
        if (storeName) {
            const [newStore] = await db.insert(stores).values({
                url: '',
                settings: { name: storeName }
            }).returning({ id: stores.id });
            defaultStoreId = newStore.id;
        }

        // Create User
        const [newUser] = await db.insert(users).values({
            email,
            passwordHash,
            fullName,
            defaultStoreId,
            isSuperAdmin: shouldBeSuperAdmin
        }).returning();

        // Login (Create Session)
        const sessionId = await createSession(newUser.id, req.ip, req.headers['user-agent']);

        reply.setCookie('session_id', sessionId, {
            path: '/',
            httpOnly: true,
            secure: false, // process.env.NODE_ENV === 'production', // Relaxed for Docker HTTP
            sameSite: 'lax', // Relaxed from strict to allow navigation flexibility
            maxAge: 60 * 60 * 24 * 7
        });

        return { status: 'success', user: { id: newUser.id, email: newUser.email, name: newUser.fullName, isSuperAdmin: newUser.isSuperAdmin } };
    });

    fastify.post('/login', async (req: any, reply) => {
        const { email, password } = req.body;

        const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
        const user = result[0];

        if (!user || !(await verifyPassword(user.passwordHash, password))) {
            return reply.status(401).send({ error: 'Invalid credentials' });
        }

        const sessionId = await createSession(user.id, req.ip, req.headers['user-agent']);

        reply.setCookie('session_id', sessionId, {
            path: '/',
            httpOnly: true,
            secure: false, // process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7 // 7 days
        });

        return { status: 'success', user: { id: user.id, email: user.email, name: user.fullName, isSuperAdmin: user.isSuperAdmin } };
    });

    fastify.post('/logout', async (req: any, reply) => {
        const sessionId = req.cookies.session_id;
        if (sessionId) {
            await destroySession(sessionId);
        }
        reply.clearCookie('session_id');
        return { status: 'success' };
    });

    fastify.get('/me', async (req: any, reply) => {
        // This relies on middleware sticking user to req
        if (!req.user) {
            return reply.status(401).send({ error: 'Not authenticated' });
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
