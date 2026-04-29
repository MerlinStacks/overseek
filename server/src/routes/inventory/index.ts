import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
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

    // Settings
    fastify.get('/settings', async (request, reply) => {
        const accountId = request.accountId;
        try {
            const settings = await prisma.inventorySettings.findUnique({ where: { accountId } });
            return settings || {};
        } catch (error: any) {
            return reply.code(500).send({ error: 'Failed to fetch settings' });
        }
    });

    fastify.post('/settings', async (request, reply) => {
        const accountId = request.accountId!;
        const { isEnabled, lowStockThresholdDays, alertEmails } = request.body as any;
        try {
            return await prisma.inventorySettings.upsert({
                where: { accountId },
                create: { accountId, isEnabled, lowStockThresholdDays, alertEmails },
                update: { isEnabled, lowStockThresholdDays, alertEmails }
            });
        } catch (error: any) {
            return reply.code(500).send({ error: 'Failed to save settings' });
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
