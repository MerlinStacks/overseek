/**
 * Validation Middleware - Fastify Native
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { ZodError, ZodSchema } from 'zod';

/**
 * Fastify validation preHandler factory
 * 
 * Usage:
 * fastify.post('/endpoint', { preHandler: [validateFastify(mySchema)] }, handler)
 */
export const validateFastify = (schema: ZodSchema<any>) => async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        schema.parse({
            body: request.body,
            query: request.query,
            params: request.params,
        });
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
