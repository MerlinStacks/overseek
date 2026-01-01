import { FastifyInstance } from 'fastify';
import axios from 'axios';
import https from 'https';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { stores } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export async function proxyRoutes(fastify: FastifyInstance) {
    fastify.addHook('preHandler', requireAuth);

    fastify.all('/*', async (req: any, reply) => {
        // Securely fetch store URL from authenticated user's context
        const storeId = req.user.defaultStoreId;
        if (!storeId) {
            return reply.status(400).send({ error: 'User has no active store' });
        }

        const store = await db.select({ url: stores.url }).from(stores).where(eq(stores.id, storeId)).limit(1);

        if (!store.length || !store[0].url) {
            return reply.status(404).send({ error: 'Store URL not configured' });
        }

        const storeUrl = store[0].url;

        // Strip /api/proxy prefix to get the path
        const path = req.url.replace('/api/proxy', '');

        // Ensure path starts with / if not empty (it returns empty if matches exactly, effectively root)
        // If path is empty string, it means we hit root logic? usually valid.

        let finalUrl = '';

        // Handle WP V2 namespace
        if (path.startsWith('/wp/v2')) {
            finalUrl = `${storeUrl}/wp-json${path}`;
        } else if (path.startsWith('/overseek/v1')) {
            finalUrl = `${storeUrl}/wp-json${path}`;
        } else {
            // Default to WC V3
            finalUrl = `${storeUrl}/wp-json/wc/v3${path}`;
        }

        // Config
        const config: any = {
            method: req.method,
            url: finalUrl,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            params: req.query,
            data: req.body,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }) // Allow self-signed
        };

        // Legacy Auth Fallback: If Authorization header missing, use query params if provided
        const authHeader = req.headers['authorization'];
        if (authHeader) {
            config.headers['Authorization'] = authHeader;
        }

        // Fix issues where axios sends data on GET
        if (req.method === 'GET' || req.method === 'HEAD') {
            delete config.data;
        }

        // Log proxy attempt for debugging
        console.log(`[Proxy] ${req.method} -> ${finalUrl}`);

        try {
            const response = await axios(config);
            reply.status(response.status).headers(response.headers as any).send(response.data);
        } catch (err: any) {
            if (err.response) {
                reply.status(err.response.status).send(err.response.data);
            } else {
                reply.status(500).send({ error: err.message });
            }
        }
    });
}
