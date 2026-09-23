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
import { lockDeliveryAccount } from '../../services/deliveryEstimates/intents';

const parseOptionalInt = (value: unknown): number | null => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? null : parsed;
};

// Do not turn malformed/fractional lead inputs into an apparently valid projection.
class InvalidSupplierLead extends Error {}
const parseLeadDays = (value: unknown): number | null => {
    if (value === undefined || value === null || value === '') return null;
    if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') throw new InvalidSupplierLead();
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) throw new InvalidSupplierLead();
    return parsed;
};

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
                    leadTimeDefault: parseLeadDays(leadTimeDefault),
                    leadTimeMin: parseLeadDays(leadTimeMin),
                    leadTimeMax: parseLeadDays(leadTimeMax),
                    paymentTerms
                }
            });
            return supplier;
        } catch (error) {
            if (error instanceof InvalidSupplierLead) return reply.code(400).send({ error: 'Supplier lead days must be integers from 0 to 3650.' });
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
            const supplier = await prisma.$transaction(async tx => {
                await lockDeliveryAccount(tx, accountId);
                return tx.supplier.update({
                    where: { id, accountId },
                    data: {
                        name,
                        contactName,
                        email,
                        phone,
                        currency: currency || 'USD',
                        leadTimeDefault: leadTimeDefault === undefined ? undefined : parseLeadDays(leadTimeDefault),
                        leadTimeMin: leadTimeMin === undefined ? undefined : parseLeadDays(leadTimeMin),
                        leadTimeMax: leadTimeMax === undefined ? undefined : parseLeadDays(leadTimeMax),
                        paymentTerms
                    }
                });
            });
            return supplier;
        } catch (error) {
            if (error instanceof InvalidSupplierLead) return reply.code(400).send({ error: 'Supplier lead days must be integers from 0 to 3650.' });
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

            await prisma.$transaction(async tx => {
                await lockDeliveryAccount(tx, accountId);
                await tx.supplier.delete({ where: { id, accountId } });
            });
            return { success: true };
        } catch (error) {
            Logger.error('Error deleting supplier', { error });
            return reply.code(500).send({ error: 'Failed to delete supplier' });
        }
    });

    // POST /suppliers/:id/items
    fastify.post<{ Params: { id: string } }>('/suppliers/:id/items', async (request, reply) => {
        const { id } = request.params;
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'No account' });

        // Why: prevent cross-account supplier item injection
        const supplier = await prisma.supplier.findFirst({ where: { id, accountId } });
        if (!supplier) return reply.code(404).send({ error: 'Supplier not found' });

        try {
            const { name, sku, cost, leadTime, moq } = request.body as any;
            const parsedCost = parseFloat(cost);
            const item = await prisma.supplierItem.create({
                data: {
                    supplierId: id,
                    name,
                    sku,
                    cost: isNaN(parsedCost) ? 0 : parsedCost,
                    leadTime: parseOptionalInt(leadTime),
                    moq: parseOptionalInt(moq) ?? 1
                }
            });
            return item;
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to add item' });
        }
    });
};
