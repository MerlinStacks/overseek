/**
 * Authentication Middleware - Fastify Native
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../utils/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

interface JwtPayload {
    userId: string;
    sessionId?: string; // Refresh token ID for current session identification
    iat: number;
    exp: number;
}

// Fastify request augmentation
declare module 'fastify' {
    interface FastifyRequest {
        user?: {
            id: string;
            sessionId?: string;
            accountId?: string;
            isSuperAdmin?: boolean;
        };
        accountId?: string;
    }
}

/**
 * Routes that require x-account-id header.
 * If a route handles account-scoped data, it belongs here.
 */
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
    '/audits',
    '/sync',
    '/reviews',
    '/cohorts',
    '/gold-price-report',
    '/search-console',
    '/dashboard',
    '/chat',
    '/roles',
    '/policies',
    '/help',
    '/notifications',
    '/tracking',
    '/labels',
    '/ads',
    '/sms',
    '/internal-products',
    '/status-center'
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
        const accountId = request.headers['x-account-id'] as string | undefined;
        let isSuperAdmin = false;

        if (accountId) {
            const membership = await prisma.accountUser.findUnique({
                where: { userId_accountId: { userId: decoded.userId, accountId } },
                select: { id: true }
            });

            if (!membership) {
                const user = await prisma.user.findUnique({
                    where: { id: decoded.userId },
                    select: { isSuperAdmin: true }
                });
                isSuperAdmin = user?.isSuperAdmin === true;

                if (!isSuperAdmin) {
                    return reply.code(403).send({ error: 'Forbidden for this account' });
                }
            }
        }

        request.user = {
            id: decoded.userId,
            sessionId: decoded.sessionId,
            accountId: accountId,
            isSuperAdmin
        };
        request.accountId = accountId;

        // Check if route requires strict accountId
        // Strip query string before matching and require exact boundary (/ or end)
        const pathWithoutQuery = request.url.split('?')[0];
        const requiresAccount = STRICT_ACCOUNT_ROUTES.some(prefix =>
            pathWithoutQuery === `/api${prefix}` || pathWithoutQuery.startsWith(`/api${prefix}/`)
        );

        if (requiresAccount && !accountId) {
            return reply.code(400).send({ error: 'Account ID required for this resource' });
        }

    } catch (err: any) {
        if (err.name === 'TokenExpiredError') {
            return reply.code(401).send({ error: 'Token expired' });
        }
        // Log fingerprint for debugging multi-container JWT issues
        const crypto = await import('crypto');
        const secret = process.env.JWT_SECRET || '';
        const fingerprint = crypto.createHash('sha256').update(secret.substring(0, 8)).digest('hex').substring(0, 12);
        Logger.info('[Auth] Token verification failed', { error: err.message, url: request.url, jwtFingerprint: fingerprint });
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
