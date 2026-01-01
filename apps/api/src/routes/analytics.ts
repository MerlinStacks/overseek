import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { analytics_events } from '../db/schema.js';
import { redact } from '../analytics/redactor.js';

export async function analyticsRoutes(fastify: FastifyInstance) {

    // Public Endpoint (No Auth Required, but tracks Session ID from Cookie/Header if present)
    fastify.post('/event', async (req: any, reply) => {
        const { event, properties, url } = req.body;

        // Try to identify user from session cookie if present (Auth Middleware not forced here)
        // But we can parse it if we want deeper integration. 
        // For now, trust the client to send a session_id or rely on `req.user` if we attach a "soft auth" middleware.

        // Actually, let's keep it simple: Client generates a random session ID or we use the Auth Cookie.
        const sessionId = req.cookies.session_id || req.headers['x-session-id'] || 'anon';
        const userId = req.user?.id || null; // Will be null if strictly unauthenticated

        // Redact PII
        const safeProps = redact(properties || {});

        try {
            await db.insert(analytics_events).values({
                event,
                properties: safeProps,
                userId,
                sessionId,
                url
            });
            return { success: true };
        } catch (e) {
            req.log.error(e);
            return reply.status(500).send({ error: "Failed to track event" });
        }
    });
}
