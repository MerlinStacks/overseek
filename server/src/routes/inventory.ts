/**
 * Inventory Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { requireAuthFastify } from '../middleware/auth';
import { PurchaseOrderService } from '../services/PurchaseOrderService';
import { PicklistService } from '../services/PicklistService';
import { InventoryService } from '../services/InventoryService';

const poService = new PurchaseOrderService();
const picklistService = new PicklistService();

const inventoryRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // --- Settings & Alerts ---

    // GET /settings
    fastify.get('/settings', async (request, reply) => {
        const accountId = request.accountId;
        try {
            const settings = await prisma.inventorySettings.findUnique({
                where: { accountId }
            });
            return settings || {};
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to fetch settings' });
        }
    });

    // POST /settings
    fastify.post<{ Body: { isEnabled?: boolean; lowStockThresholdDays?: number; alertEmails?: string[] } }>('/settings', async (request, reply) => {
        const accountId = request.accountId!;
        const { isEnabled, lowStockThresholdDays, alertEmails } = request.body;
        try {
            const settings = await prisma.inventorySettings.upsert({
                where: { accountId },
                create: { accountId, isEnabled, lowStockThresholdDays, alertEmails },
                update: { isEnabled, lowStockThresholdDays, alertEmails }
            });
            return settings;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to save settings' });
        }
    });

    // GET /health
    fastify.get('/health', async (request, reply) => {
        const accountId = request.accountId;
        try {
            const risks = await InventoryService.checkInventoryHealth(accountId!);
            return risks;
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to check inventory health' });
        }
    });

    // --- Suppliers ---

    fastify.get('/suppliers', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            const suppliers = await prisma.supplier.findMany({
                where: { accountId },
                include: { items: true },
                orderBy: { name: 'asc' }
            });
            return suppliers;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to fetch suppliers' });
        }
    });

    fastify.post('/suppliers', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            const { name, contactName, email, phone, currency, leadTimeDefault, leadTimeMin, leadTimeMax, paymentTerms } = request.body as any;
            const supplier = await prisma.supplier.create({
                data: {
                    accountId,
                    name,
                    contactName,
                    email,
                    phone,
                    currency: currency || 'USD',
                    leadTimeDefault: leadTimeDefault ? parseInt(leadTimeDefault) : null,
                    leadTimeMin: leadTimeMin ? parseInt(leadTimeMin) : null,
                    leadTimeMax: leadTimeMax ? parseInt(leadTimeMax) : null,
                    paymentTerms
                }
            });
            return supplier;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to create supplier' });
        }
    });

    fastify.put<{ Params: { id: string } }>('/suppliers/:id', async (request, reply) => {
        const accountId = request.accountId;
        const { id } = request.params;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            // Verify supplier belongs to account
            const existing = await prisma.supplier.findFirst({
                where: { id, accountId }
            });
            if (!existing) return reply.code(404).send({ error: 'Supplier not found' });

            const { name, contactName, email, phone, currency, leadTimeDefault, leadTimeMin, leadTimeMax, paymentTerms } = request.body as any;
            const supplier = await prisma.supplier.update({
                where: { id },
                data: {
                    name,
                    contactName,
                    email,
                    phone,
                    currency: currency || 'USD',
                    leadTimeDefault: leadTimeDefault ? parseInt(leadTimeDefault) : null,
                    leadTimeMin: leadTimeMin ? parseInt(leadTimeMin) : null,
                    leadTimeMax: leadTimeMax ? parseInt(leadTimeMax) : null,
                    paymentTerms
                }
            });
            return supplier;
        } catch (error) {
            Logger.error('Error updating supplier', { error });
            return reply.code(500).send({ error: 'Failed to update supplier' });
        }
    });

    fastify.delete<{ Params: { id: string } }>('/suppliers/:id', async (request, reply) => {
        const accountId = request.accountId;
        const { id } = request.params;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
            // Verify supplier belongs to account
            const existing = await prisma.supplier.findFirst({
                where: { id, accountId }
            });
            if (!existing) return reply.code(404).send({ error: 'Supplier not found' });

            await prisma.supplier.delete({ where: { id } });
            return { success: true };
        } catch (error) {
            Logger.error('Error deleting supplier', { error });
            return reply.code(500).send({ error: 'Failed to delete supplier' });
        }
    });

    fastify.post<{ Params: { id: string } }>('/suppliers/:id/items', async (request, reply) => {
        const { id } = request.params;
        try {
            const { name, sku, cost, leadTime, moq } = request.body as any;
            const item = await prisma.supplierItem.create({
                data: {
                    supplierId: id,
                    name,
                    sku,
                    cost: parseFloat(cost),
                    leadTime: leadTime ? parseInt(leadTime) : null,
                    moq: moq ? parseInt(moq) : 1
                }
            });
            return item;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to add item' });
        }
    });

    // --- BOM ---

    fastify.get<{ Params: { productId: string } }>('/products/:productId/bom', async (request, reply) => {
        const { productId } = request.params;
        const query = request.query as { variationId?: string };
        const variationId = parseInt(query.variationId || '0');

        try {
            const bom = await prisma.bOM.findUnique({
                where: {
                    productId_variationId: { productId, variationId }
                },
                include: {
                    items: {
                        include: {
                            supplierItem: { include: { supplier: true } },
                            childProduct: true
                        }
                    }
                }
            });
            return bom || { items: [] };
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to fetch BOM' });
        }
    });

    fastify.post<{ Params: { productId: string } }>('/products/:productId/bom', async (request, reply) => {
        const { productId } = request.params;
        const { items, variationId = 0 } = request.body as any;

        try {
            const bom = await prisma.bOM.upsert({
                where: {
                    productId_variationId: { productId, variationId: Number(variationId) }
                },
                create: { productId, variationId: Number(variationId) },
                update: {}
            });

            // Prepare items, ensuring undefined/null values are handled correctly
            // We use a transaction with individual creates to ensure better error handling and UUID generation
            await prisma.$transaction(async (tx) => {
                await tx.bOMItem.deleteMany({ where: { bomId: bom.id } });
                
                for (const item of items) {
                    await tx.bOMItem.create({
                        data: {
                            bomId: bom.id,
                            supplierItemId: item.supplierItemId || null,
                            childProductId: item.childProductId || null,
                            quantity: item.quantity,
                            wasteFactor: item.wasteFactor || 0
                        }
                    });
                }
            });

            const updated = await prisma.bOM.findUnique({
                where: { id: bom.id },
                include: { items: { include: { supplierItem: true, childProduct: true } } }
            });

            return updated;
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to save BOM' });
        }
    });

    // --- Purchase Orders ---

    fastify.get('/purchase-orders', async (request, reply) => {
        const accountId = request.accountId!;
        const { status } = request.query as { status?: string };
        try {
            const orders = await poService.listPurchaseOrders(accountId, status);
            return orders;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to fetch POs' });
        }
    });

    fastify.get<{ Params: { id: string } }>('/purchase-orders/:id', async (request, reply) => {
        const accountId = request.accountId!;
        const { id } = request.params;
        try {
            const po = await poService.getPurchaseOrder(accountId, id);
            if (!po) return reply.code(404).send({ error: 'PO not found' });
            return po;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to fetch PO' });
        }
    });

    fastify.post('/purchase-orders', async (request, reply) => {
        const accountId = request.accountId!;
        try {
            const po = await poService.createPurchaseOrder(accountId, request.body as any);
            return po;
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to create PO' });
        }
    });

    fastify.put<{ Params: { id: string } }>('/purchase-orders/:id', async (request, reply) => {
        const accountId = request.accountId!;
        const { id } = request.params;
        try {
            await poService.updatePurchaseOrder(accountId, id, request.body as any);
            const updated = await poService.getPurchaseOrder(accountId, id);
            return updated;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to update PO' });
        }
    });

    // --- Picklist ---

    fastify.get('/picklist', async (request, reply) => {
        const accountId = request.accountId!;
        const { status, limit } = request.query as { status?: string; limit?: string };
        try {
            const picklist = await picklistService.generatePicklist(accountId, {
                status,
                limit: limit ? Number(limit) : undefined
            });
            return picklist;
        } catch (error) {
            Logger.error('Error', { error });
            return reply.code(500).send({ error: 'Failed to generate picklist' });
        }
    });
};

export default inventoryRoutes;
