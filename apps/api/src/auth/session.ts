import { db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { generateSessionId } from './utils.js';
import { eq, gt } from 'drizzle-orm';
import { FastifyRequest, FastifyReply } from 'fastify';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const COOKIE_NAME = 'session_id';

export const createSession = async (userId: number, ip: string = '', ua: string = '') => {
    const sessionId = generateSessionId();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await db.insert(sessions).values({
        id: sessionId,
        userId,
        expiresAt,
        ipAddress: ip,
        userAgent: ua
    });

    return sessionId;
};

export const destroySession = async (sessionId: string) => {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
};

export const getSessionUser = async (sessionId: string) => {
    const today = new Date();
    const result = await db.select({
        user: users,
        session: sessions
    })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!result.length) return null;

    const { user, session } = result[0];

    // Check expiration
    if (session.expiresAt < today) {
        await destroySession(sessionId);
        return null;
    }

    return user;
};
