import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuthFastify } from '../../middleware/auth';
import { PermissionService } from '../../services/PermissionService';
import { GuardedReceiptError } from '../../services/deliveryEstimates/receipts';
import { deleteWriteOff, finalizeWriteOff, getWriteOff, listWriteOffs, saveWriteOff, writeOffBodySchema, writeOffProducts, writeOffQuerySchema } from '../../services/StockWriteOffService';

export const stockWriteOffRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.user?.id) return reply.code(401).send({ error: 'Authentication required' });
        if (!request.accountId) return reply.code(400).send({ error: 'Account ID required' });
        const p = await PermissionService.resolvePermissions(request.user.id, request.accountId);
        if (p['*'] !== true && !(p.manage_inventory === true && p.view_cogs === true)) return reply.code(403).send({ error: 'manage_inventory and view_cogs permissions are required' });
    });
    fastify.setErrorHandler((error, request, reply) => {
        if (error instanceof z.ZodError) return reply.code(400).send({ error: error.issues[0]?.message ?? 'Invalid request' });
        if (error instanceof GuardedReceiptError) return reply.code(409).send({ error: error.message });
        const status = (error as { statusCode?: number }).statusCode;
        if (status && status < 500) return reply.code(status).send({ error: (error as Error).message });
        request.log.error({ err: error }, 'Stock write-off request failed');
        return reply.code(500).send({ error: 'Stock write-off request failed' });
    });
    const id = (params: unknown) => z.object({ id: z.string().min(1).max(100) }).parse(params).id;
    fastify.get('/write-offs/products', request => writeOffProducts(request.accountId!, z.object({ search: z.string().trim().max(200).default('') }).parse(request.query).search));
    fastify.get('/write-offs/report', request => listWriteOffs(request.accountId!, writeOffQuerySchema.parse(request.query), true));
    fastify.get('/write-offs', request => listWriteOffs(request.accountId!, writeOffQuerySchema.parse(request.query)));
    fastify.get('/write-offs/:id', request => getWriteOff(request.accountId!, id(request.params)));
    fastify.post('/write-offs', async (request, reply) => reply.code(201).send(await saveWriteOff(request.accountId!, request.user!.id, writeOffBodySchema.parse(request.body))));
    fastify.put('/write-offs/:id', request => saveWriteOff(request.accountId!, request.user!.id, writeOffBodySchema.parse(request.body), id(request.params)));
    fastify.delete('/write-offs/:id', request => deleteWriteOff(request.accountId!, request.user!.id, id(request.params)));
    fastify.post('/write-offs/:id/finalize', request => finalizeWriteOff(request.accountId!, request.user!.id, id(request.params)));
};
