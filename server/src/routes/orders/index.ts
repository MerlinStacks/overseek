/**
 * Orders Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { requireAuthFastify } from '../../middleware/auth';
import { z } from 'zod';
import { cacheAside, CacheTTL } from '../../utils/cache';
import { extractOrderTracking } from '../../utils/orderTracking';
import attributionRoutes from './attribution';
import tagsRoutes from './tags';
import bulkRoutes from './bulk';

const orderIdParamSchema = z.object({
    id: z.union([
        z.string().uuid(),
        z.string().regex(/^\d+$/, "ID must be a UUID or a numeric string")
    ])
});

const ordersRoutes: FastifyPluginAsync = async (fastify) => {
    // Protect all order routes
    fastify.addHook('preHandler', requireAuthFastify);

    // List Orders with optional filters
    // GET /api/orders?customerId=123&limit=5
    // GET /api/orders?billingEmail=guest@example.com&limit=5
    fastify.get('/', async (request, reply) => {
        const accountId = request.user?.accountId;
        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        const query = request.query as {
            customerId?: string;
            billingEmail?: string;
            limit?: string;
        };

        const limit = Math.min(parseInt(query.limit || '20', 10), 100);

        // Why: validate BEFORE cacheAside — returning reply.send() inside the
        // cache callback would cache the Fastify reply object instead of data.
        let parsedCustomerId: number | undefined;
        if (query.customerId) {
            parsedCustomerId = parseInt(query.customerId, 10);
            if (isNaN(parsedCustomerId)) {
                return reply.code(400).send({ error: 'customerId must be a numeric value' });
            }
        }

        try {
            // Build cache key from filter params
            const cacheKey = `orders:list:${accountId}:${limit}:${query.customerId || 'none'}:${query.billingEmail || 'none'}`;

            const result = await cacheAside(
                cacheKey,
                async () => {
                    let whereClause: { accountId: string; wooCustomerId?: number; billingEmail?: string } = { accountId };

                    if (parsedCustomerId !== undefined) {
                        whereClause.wooCustomerId = parsedCustomerId;
                    } else if (query.billingEmail) {
                        // Emails are normalized to lowercase on sync, so match with lowercase input
                        whereClause.billingEmail = query.billingEmail.toLowerCase().trim();
                    }

                    const orders = await prisma.wooOrder.findMany({
                        where: whereClause,
                        orderBy: { dateCreated: 'desc' },
                        take: limit,
                        select: {
                            id: true,
                            wooId: true,
                            number: true,
                            status: true,
                            total: true,
                            currency: true,
                            dateCreated: true
                        }
                    });

                    return { orders };
                },
                { ttl: CacheTTL.SHORT, namespace: 'orders' } // 30s cache
            );

            return result;
        } catch (error) {
            Logger.error('Failed to list orders', { error });
            return reply.code(500).send({ error: 'Failed to list orders' });
        }
    });

    // Get Order by ID (Internal ID or WooID)
    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const parsed = orderIdParamSchema.safeParse(request.params);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
        const { id } = parsed.data;
        const accountId = request.user?.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        try {
            let order;

            // Try finding by internal UUID first (scoped to account to prevent IDOR)
            order = await prisma.wooOrder.findFirst({
                where: { id, accountId }
            });

            // If not found and ID is numeric, try finding by WooID
            if (!order && !isNaN(Number(id))) {
                order = await prisma.wooOrder.findUnique({
                    where: {
                        accountId_wooId: {
                            accountId,
                            wooId: Number(id)
                        }
                    }
                });
            }

            if (!order) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            // Lookup customer metadata for order count
            const rawData = order.rawData as { customer_id?: number; tags?: string[] };
            let customerMeta = null;

            if (rawData.customer_id && rawData.customer_id > 0) {
                const customer = await prisma.wooCustomer.findUnique({
                    where: {
                        accountId_wooId: {
                            accountId,
                            wooId: rawData.customer_id
                        }
                    },
                    select: {
                        id: true,
                        wooId: true,
                        ordersCount: true
                    }
                });

                if (customer) {
                    customerMeta = {
                        internalId: customer.id,
                        wooId: customer.wooId,
                        ordersCount: customer.ordersCount
                    };
                }
            }

            // Compute tags from product mappings (same as sync does)
            const { OrderTaggingService } = await import('../../services/OrderTaggingService');
            const computedTags = await OrderTaggingService.extractTagsFromOrder(accountId, order.rawData);

            // Merge computed tags with any manually-added tags from rawData
            const manualTags = rawData.tags || [];
            const allTags = [...new Set([...computedTags, ...manualTags])];

            // Extract shipment tracking from rawData meta_data
            const trackingItems = extractOrderTracking(order.rawData);

            // Return the raw data which contains all the nice Woo fields
            return {
                ...order.rawData as object,
                tracking_items: trackingItems,
                tracking_number: trackingItems[0]?.trackingNumber ?? null,
                tracking_url: trackingItems[0]?.trackingUrl ?? null,
                tags: allTags,
                internal_id: order.id,
                internal_status: order.status,
                internal_updated_at: order.updatedAt,
                _customerMeta: customerMeta
            };

        } catch (error) {
            Logger.error('Failed to fetch order', { error });
            return reply.code(500).send({ error: 'Failed to fetch order details' });
        }
    });

    // Get Fraud Score for an Order
    fastify.get<{ Params: { id: string } }>('/:id/fraud-score', async (request, reply) => {
        const parsedParams = orderIdParamSchema.safeParse(request.params);
        if (!parsedParams.success) return reply.code(400).send({ error: parsedParams.error.issues[0].message });
        const { id } = parsedParams.data;
        const accountId = request.user?.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        try {
            let order;

            // Try finding by internal UUID first (scoped to account to prevent IDOR)
            order = await prisma.wooOrder.findFirst({ where: { id, accountId } });

            // If not found and ID is numeric, try finding by WooID
            if (!order && !isNaN(Number(id))) {
                order = await prisma.wooOrder.findUnique({
                    where: { accountId_wooId: { accountId, wooId: Number(id) } }
                });
            }

            if (!order) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            // Get customer meta for order count
            const rawData = order.rawData as Record<string, unknown>;
            const customerId = typeof rawData.customer_id === 'number' ? rawData.customer_id : Number(rawData.customer_id);
            let customerMeta = null;

            if (customerId && customerId > 0) {
                const customer = await prisma.wooCustomer.findUnique({
                    where: { accountId_wooId: { accountId, wooId: customerId } },
                    select: { ordersCount: true }
                });
                if (customer) {
                    customerMeta = { ordersCount: customer.ordersCount };
                }
            }

            const { FraudService } = await import('../../services/FraudService');
            const result = FraudService.calculateScore({ ...rawData, _customerMeta: customerMeta });

            return result;
        } catch (error) {
            Logger.error('Failed to calculate fraud score', { error });
            return reply.code(500).send({ error: 'Failed to calculate fraud score' });
        }
    });

    // Sub-routes
    await fastify.register(attributionRoutes);
    await fastify.register(tagsRoutes);
    await fastify.register(bulkRoutes);
};

export default ordersRoutes;
