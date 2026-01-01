import { FastifyRequest, FastifyReply } from 'fastify';
import { getSessionUser } from '../auth/session.js';

export const requireAuth = async (req: any, reply: FastifyReply) => {
    const sessionId = req.cookies.session_id;
    console.log('Auth check - Cookies:', req.cookies, 'SessionID:', sessionId);

    if (!sessionId) {
        return reply.status(401).send({ error: 'Unauthorized: No session' });
    }

    const user = await getSessionUser(sessionId);
    if (!user) {
        reply.clearCookie('session_id');
        return reply.status(401).send({ error: 'Unauthorized: Invalid session' });
    }

    // Attach user to request
    req.user = user;
};
