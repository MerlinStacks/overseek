import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../../middleware/auth';
import { PermissionService } from '../../services/PermissionService';

/** Replaying purchase receipts is not a repair protocol. No stock/status/index writes here. */
const maintenanceRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Selected account required' });
        if (!await PermissionService.hasPermission(request.user.id, request.accountId, 'manage_inventory')) return reply.code(403).send({ error: 'Inventory management required' });
    });
    for (const path of ['/repair-received-pos', '/reprocess-received-pos']) {
        fastify.post(path, async (_request, reply) => reply.code(410).send({ error: 'Automatic receipt replay disabled. Reconcile existing stock receipts and review a bounded repair plan; no inventory or indexing work was started.' }));
    }
    fastify.get('/reprocess-status', async () => ({ status: 'disabled', reason: 'No durable reviewed repair protocol is available. Historical in-process progress cannot establish recovery.' }));
};
export default maintenanceRoutes;
