/**
 * Validation Middleware - Fastify Native
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { ZodError, type ZodSchema } from 'zod';

type ValidatedRequest = { body?: unknown; query?: unknown; params?: unknown };

/**
 * Fastify validation preHandler factory
 * 
 * Usage:
 * fastify.post('/endpoint', { preHandler: [validateFastify(mySchema)] }, handler)
 */
export const validateFastify = <T extends ValidatedRequest>(schema: ZodSchema<T>) => async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        const parsed = await schema.parseAsync({
            body: request.body,
            query: request.query,
            params: request.params,
        });

        // Apply defaults/transforms only after the entire request validates.
        // A body-only schema must not erase the route's params or query.
        for (const section of ['body', 'query', 'params'] as const) {
            if (Object.prototype.hasOwnProperty.call(parsed, section)) {
                request[section] = parsed[section];
            }
        }
    } catch (error) {
        if (error instanceof ZodError) {
            return reply.code(400).send({
                error: 'Validation failed',
                details: error.issues.map((e) => ({
                    path: e.path.join('.'),
                    message: e.message,
                })),
            });
        }
        return reply.code(500).send({ error: 'Internal server error during validation' });
    }
};
