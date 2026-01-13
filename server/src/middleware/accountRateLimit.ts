/**
 * Account Rate Limit Middleware
 * 
 * Per-account API rate limiting hook for Fastify.
 * Uses RateLimitService for distributed counting via Redis.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { RateLimitService } from '../services/RateLimitService';
import { Logger } from '../utils/logger';

/**
 * Extract account ID from request.
 * Checks auth context, then x-account-id header.
 */
function getAccountIdFromRequest(request: FastifyRequest): string | null {
    // From authenticated context (set by requireAuthFastify)
    const authContext = (request as any).accountId;
    if (authContext) return authContext;

    // From header (for API clients)
    const headerAccountId = request.headers['x-account-id'] as string;
    if (headerAccountId) return headerAccountId;

    return null;
}

/**
 * Fastify preHandler hook for per-account rate limiting.
 * Applies AFTER authentication (needs account context).
 * 
 * @example
 * // In a route file:
 * fastify.addHook('preHandler', accountRateLimitHook);
 */
export async function accountRateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    const accountId = getAccountIdFromRequest(request);

    // Skip if no account context (unauthenticated routes handled by global IP limit)
    if (!accountId) {
        return;
    }

    const result = await RateLimitService.checkLimit(accountId);

    // Set rate limit headers
    reply.header('X-RateLimit-Limit', result.limit.toString());
    reply.header('X-RateLimit-Remaining', result.remaining.toString());
    reply.header('X-RateLimit-Reset', Math.floor(result.resetAt.getTime() / 1000).toString());

    if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000);
        reply.header('Retry-After', retryAfter.toString());

        Logger.warn('[RateLimit] Request blocked', {
            accountId,
            remaining: result.remaining,
            limit: result.limit,
            tier: result.tier,
        });

        reply.code(429).send({
            error: 'Too many requests',
            message: `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
            retryAfter,
            limit: result.limit,
            tier: result.tier,
        });
        return;
    }
}

/**
 * Create a rate limit hook with custom options.
 * Useful for routes that need different behavior.
 */
export function createAccountRateLimitHook(options?: {
    skipPaths?: string[];
    onlyPaths?: string[];
}) {
    return async function rateLimitHook(
        request: FastifyRequest,
        reply: FastifyReply
    ): Promise<void> {
        // Skip certain paths if configured
        if (options?.skipPaths?.some(path => request.url.startsWith(path))) {
            return;
        }

        // Only apply to certain paths if configured
        if (options?.onlyPaths && !options.onlyPaths.some(path => request.url.startsWith(path))) {
            return;
        }

        return accountRateLimitHook(request, reply);
    };
}
