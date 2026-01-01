import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '../auth/utils.js';
import { createSession, destroySession } from '../auth/session.js';

export async function authRoutes(fastify: FastifyInstance) {
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
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 7 // 7 days
        });

        return { status: 'success', user: { id: user.id, email: user.email, name: user.fullName } };
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
            storeId: req.user.defaultStoreId
        };
    });
}
