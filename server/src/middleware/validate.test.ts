import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateFastify } from './validate';

describe('validateFastify', () => {
    let app: FastifyInstance;
    beforeEach(() => { app = Fastify(); });
    afterEach(async () => { await app.close(); });

    it('passes parsed body, params and query to the handler', async () => {
        const schema = z.object({
            body: z.object({ name: z.string().trim(), quantity: z.coerce.number().default(1) }),
            query: z.object({ page: z.coerce.number().default(1) }),
            params: z.object({ id: z.coerce.number() }),
        });
        app.post('/items/:id', { preHandler: validateFastify(schema) }, async request => ({
            body: request.body, query: request.query, params: request.params,
        }));
        const response = await app.inject({
            method: 'POST', url: '/items/42?page=2&extra=ignored', payload: { name: ' Mug ', extra: 'ignored' },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ body: { name: 'Mug', quantity: 1 }, query: { page: 2 }, params: { id: 42 } });
    });

    it('preserves query and params omitted from a body-only schema', async () => {
        const schema = z.object({ body: z.object({ name: z.string().trim() }) });
        app.post('/items/:id', { preHandler: validateFastify(schema) }, async request => ({
            body: request.body, query: request.query, params: request.params,
        }));
        const response = await app.inject({ method: 'POST', url: '/items/original?filter=keep', payload: { name: ' Mug ' } });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ body: { name: 'Mug' }, query: { filter: 'keep' }, params: { id: 'original' } });
    });

    it('preserves body and query omitted from a params-only schema', async () => {
        const schema = z.object({ params: z.object({ id: z.coerce.number() }) });
        app.post('/items/:id', { preHandler: validateFastify(schema) }, async request => ({
            body: request.body, query: request.query, params: request.params,
        }));
        const response = await app.inject({ method: 'POST', url: '/items/7?filter=keep', payload: { arbitrary: true } });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ body: { arbitrary: true }, query: { filter: 'keep' }, params: { id: 7 } });
    });

    it('supports explicitly passthrough schemas without stripping allowed extras', async () => {
        app.post('/', { preHandler: validateFastify(z.object({ body: z.object({ name: z.string() }).passthrough() })) },
            async request => request.body);
        const response = await app.inject({ method: 'POST', url: '/', payload: { name: 'Mug', extra: 'keep' } });
        expect(response.json()).toEqual({ name: 'Mug', extra: 'keep' });
    });

    it('awaits async transformations before running the handler', async () => {
        const schema = z.object({ body: z.object({ name: z.string().transform(async value => value.toUpperCase()) }) });
        app.post('/', { preHandler: validateFastify(schema) }, async request => request.body);
        const response = await app.inject({ method: 'POST', url: '/', payload: { name: 'mug' } });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ name: 'MUG' });
    });

    it('keeps the existing 400 format for async validation failures and does not run the handler', async () => {
        const handler = vi.fn(async () => ({ ok: true }));
        const schema = z.object({ body: z.object({ name: z.string().refine(async value => value !== 'taken', 'Name is taken') }) });
        app.post('/', { preHandler: validateFastify(schema) }, handler);
        const response = await app.inject({ method: 'POST', url: '/', payload: { name: 'taken' } });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'Validation failed', details: [{ path: 'body.name', message: 'Name is taken' }] });
        expect(handler).not.toHaveBeenCalled();
    });

    it('preserves nested error paths and leaves all request sections unmodified on failure', async () => {
        let captured: FastifyRequest;
        app.addHook('preValidation', async request => { captured = request; });
        const schema = z.object({
            body: z.object({ name: z.string().trim(), items: z.array(z.object({ quantity: z.number().positive('Must be positive') })) }),
            params: z.object({ id: z.coerce.number() }),
        });
        const handler = vi.fn(async () => ({ ok: true }));
        app.post('/items/:id', { preHandler: validateFastify(schema) }, handler);
        const body = { name: ' Mug ', items: [{ quantity: -1 }] };
        const response = await app.inject({ method: 'POST', url: '/items/7?filter=keep', payload: body });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'Validation failed', details: [{ path: 'body.items.0.quantity', message: 'Must be positive' }] });
        expect(captured!.body).toEqual(body);
        expect(captured!.params).toEqual({ id: '7' });
        expect(captured!.query).toEqual({ filter: 'keep' });
        expect(handler).not.toHaveBeenCalled();
    });

    it('preserves the generic 500 response for unexpected errors without leaking details', async () => {
        const schema = z.object({ body: z.object({ name: z.string().transform(async () => { throw new Error('private detail'); }) }) });
        const handler = vi.fn(async () => ({ ok: true }));
        app.post('/', { preHandler: validateFastify(schema) }, handler);
        const response = await app.inject({ method: 'POST', url: '/', payload: { name: 'Mug' } });
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ error: 'Internal server error during validation' });
        expect(handler).not.toHaveBeenCalled();
    });
});
