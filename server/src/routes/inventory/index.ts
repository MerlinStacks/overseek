import { FastifyPluginAsync } from 'fastify';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { InventoryService } from '../../services/InventoryService';
import { bomManagementRoutes } from './bomManagement';
import { bomSyncRoutes } from './bomSync';
import { supplierRoutes } from './suppliers';
import bomProductRoutes from './bom-products';
import purchaseOrderRoutes from './purchase-orders';
import picklistRoutes from './picklist';
import maintenanceRoutes from './maintenance';
import { stockMovementRoutes } from './stock-movements';
import { stockWriteOffRoutes } from './write-offs';
import { PermissionService } from '../../services/PermissionService';
import { readInventoryAlertSettings, saveInventoryAlertSettings } from '../../services/InventoryAlertSettings';

const inventoryRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Existing modular sub-routes
    await fastify.register(supplierRoutes);
    await fastify.register(bomSyncRoutes);
    await fastify.register(bomManagementRoutes);

    // New modular sub-routes
    await fastify.register(bomProductRoutes);
    await fastify.register(purchaseOrderRoutes);
    await fastify.register(picklistRoutes);
    await fastify.register(maintenanceRoutes);
    await fastify.register(stockMovementRoutes);
    await fastify.register(stockWriteOffRoutes);

    // Settings
    fastify.get('/settings', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId || !request.user?.id) return reply.code(400).send({ error: 'Selected account required' });
        if (!await PermissionService.hasPermission(request.user.id, accountId, 'view_inventory')) return reply.code(403).send({ error: 'Inventory read access required' });
        try {
            return await readInventoryAlertSettings(accountId);
        } catch (error: any) {
            return reply.code(500).send({ error: 'Failed to fetch settings' });
        }
    });

    fastify.post('/settings', async (request, reply) => {
        const accountId = request.accountId!;
        if (!accountId || !request.user?.id) return reply.code(400).send({ error: 'Selected account required' });
        if (!await PermissionService.hasPermission(request.user.id, accountId, 'manage_inventory')) return reply.code(403).send({ error: 'Inventory management required' });
        try {
            return await saveInventoryAlertSettings(accountId, request.user.id, request.body);
        } catch (error: any) {
            return reply.code(error?.statusCode === 409 ? 409 : error?.name === 'ZodError' ? 400 : 503).send({ error: 'Save not acknowledged. Preserve the draft and reconcile before retrying.' });
        }
    });

    // Health
    fastify.get('/health', async (request, reply) => {
        const accountId = request.accountId;
        try {
            return await InventoryService.checkInventoryHealth(accountId!);
        } catch (error: any) {
            Logger.error('Error checking inventory health', { error });
            return reply.code(500).send({ error: 'Failed to check inventory health' });
        }
    });
};

export default inventoryRoutes;
