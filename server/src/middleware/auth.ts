/**
 * Authentication Middleware - Fastify Native
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../utils/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

interface JwtPayload {
    userId: string;
    iat: number;
    exp: number;
}

// Fastify request augmentation
declare module 'fastify' {
    interface FastifyRequest {
        user?: {
            id: string;
            accountId?: string;
            isSuperAdmin?: boolean;
        };
        accountId?: string;
    }
}

// Strict account routes that require accountId
const STRICT_ACCOUNT_ROUTES = [
    '/customers',
    '/products',
    '/marketing',
    '/orders',
    '/analytics',
    '/woo/configure',
    '/inventory',
    '/invoices',
    '/email',
    '/segments',
    '/audits'
];

/**
 * Fastify authentication preHandler
 */
export const requireAuthFastify = async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    const queryToken = (request.query as any)?.token;

    let token: string | undefined;

    if (authHeader) {
        token = authHeader.split(' ')[1];
    } else if (queryToken && request.url.startsWith('/admin/queues')) {
        token = queryToken;
    }

    if (!token) {
        return reply.code(401).send({ error: 'No token provided' });
    }

    try {
        const decoded = verifyToken(token) as JwtPayload;
        const accountId = request.headers['x-account-id'] as string;

        request.user = {
            id: decoded.userId,
            accountId: accountId
        };
        request.accountId = accountId;

        // Check if route requires strict accountId
        const path = request.url;
        const requiresAccount = STRICT_ACCOUNT_ROUTES.some(prefix => path.startsWith(`/api${prefix}`));

        if (requiresAccount && !accountId) {
            return reply.code(400).send({ error: 'Account ID required for this resource' });
        }

    } catch (err: any) {
        if (err.name === 'TokenExpiredError') {
            return reply.code(401).send({ error: 'Token expired' });
        }
        Logger.warn('Auth failed', { error: err.message, url: request.url });
        return reply.code(401).send({ error: 'Invalid token' });
    }
};

/**
 * Fastify super admin authorization preHandler
 */
export const requireSuperAdminFastify = async (request: FastifyRequest, reply: FastifyReply) => {
    // First run normal auth
    await requireAuthFastify(request, reply);

    // Check if reply was already sent (auth failed)
    if (reply.sent) return;

    if (!request.user?.id) {
        return reply.code(401).send({ error: 'Authentication required' });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: request.user.id },
            select: { isSuperAdmin: true }
        });

        if (!user?.isSuperAdmin) {
            return reply.code(403).send({ error: 'Super admin access required' });
        }

        request.user.isSuperAdmin = true;
    } catch (err) {
        Logger.error('Super admin check failed', { error: err });
        return reply.code(500).send({ error: 'Authorization check failed' });
    }
};
