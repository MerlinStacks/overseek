/**
 * Supplier Management Routes
 * 
 * Handles CRUD operations for suppliers and supplier items.
 * Extracted from inventory.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify } from '../../middleware/auth';
import { Logger } from '../../utils/logger';

export const supplierRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // GET /suppliers
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

    // POST /suppliers
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

    // PUT /suppliers/:id
    fastify.put<{ Params: { id: string } }>('/suppliers/:id', async (request, reply) => {
        const accountId = request.accountId;
        const { id } = request.params;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
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

    // DELETE /suppliers/:id
    fastify.delete<{ Params: { id: string } }>('/suppliers/:id', async (request, reply) => {
        const accountId = request.accountId;
        const { id } = request.params;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        try {
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

    // POST /suppliers/:id/items
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
};
