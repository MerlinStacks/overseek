/**
 * Orders Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { requireAuthFastify } from '../middleware/auth';
import { z } from 'zod';

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

        try {
            let whereClause: any = { accountId };

            if (query.customerId) {
                // Filter by WooCommerce customer_id in rawData
                whereClause.rawData = {
                    path: ['customer_id'],
                    equals: parseInt(query.customerId, 10)
                };
            } else if (query.billingEmail) {
                // Filter by billing email in rawData for guest checkouts
                // WooCommerce stores email at rawData.billing.email
                whereClause.rawData = {
                    path: ['billing', 'email'],
                    string_contains: query.billingEmail.toLowerCase()
                };
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
        } catch (error) {
            Logger.error('Failed to list orders', { error });
            return reply.code(500).send({ error: 'Failed to list orders' });
        }
    });

    // Get Order by ID (Internal ID or WooID)
    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const { id } = orderIdParamSchema.parse(request.params);
        const accountId = request.user?.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        try {
            let order;

            // Try finding by internal UUID first
            order = await prisma.wooOrder.findUnique({
                where: { id: id }
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

            // Ensure the order belongs to the requesting account (security check)
            if (order.accountId !== accountId) {
                return reply.code(403).send({ error: 'Access denied' });
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
            const { OrderTaggingService } = await import('../services/OrderTaggingService');
            const computedTags = await OrderTaggingService.extractTagsFromOrder(accountId, order.rawData);

            // Merge computed tags with any manually-added tags from rawData
            const manualTags = rawData.tags || [];
            const allTags = [...new Set([...computedTags, ...manualTags])];

            // Return the raw data which contains all the nice Woo fields
            return {
                ...order.rawData as object,
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
        const { id } = orderIdParamSchema.parse(request.params);
        const accountId = request.user?.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        try {
            let order;

            // Try finding by internal UUID first
            order = await prisma.wooOrder.findUnique({ where: { id } });

            // If not found and ID is numeric, try finding by WooID
            if (!order && !isNaN(Number(id))) {
                order = await prisma.wooOrder.findUnique({
                    where: { accountId_wooId: { accountId, wooId: Number(id) } }
                });
            }

            if (!order || order.accountId !== accountId) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            // Get customer meta for order count
            const rawData = order.rawData as any;
            let customerMeta = null;

            if (rawData.customer_id && rawData.customer_id > 0) {
                const customer = await prisma.wooCustomer.findUnique({
                    where: { accountId_wooId: { accountId, wooId: rawData.customer_id } },
                    select: { ordersCount: true }
                });
                if (customer) {
                    customerMeta = { ordersCount: customer.ordersCount };
                }
            }

            const { FraudService } = await import('../services/FraudService');
            const result = FraudService.calculateScore({ ...rawData, _customerMeta: customerMeta });

            return result;
        } catch (error) {
            Logger.error('Failed to calculate fraud score', { error });
            return reply.code(500).send({ error: 'Failed to calculate fraud score' });
        }
    });

    // Get Attribution data for an Order
    fastify.get<{ Params: { id: string } }>('/:id/attribution', async (request, reply) => {
        const { id } = orderIdParamSchema.parse(request.params);
        const accountId = request.user?.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        try {
            let order;

            // Try finding by internal UUID first
            order = await prisma.wooOrder.findUnique({ where: { id } });

            // If not found and ID is numeric, try finding by WooID
            if (!order && !isNaN(Number(id))) {
                order = await prisma.wooOrder.findUnique({
                    where: { accountId_wooId: { accountId, wooId: Number(id) } }
                });
            }

            if (!order || order.accountId !== accountId) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            // Find purchase event that matches this order's wooId
            // The purchase event stores orderId in the payload
            const purchaseEvent = await prisma.analyticsEvent.findFirst({
                where: {
                    type: 'purchase',
                    session: { accountId }
                },
                include: {
                    session: {
                        select: {
                            firstTouchSource: true,
                            lastTouchSource: true,
                            utmSource: true,
                            utmMedium: true,
                            utmCampaign: true,
                            referrer: true,
                            country: true,
                            city: true,
                            deviceType: true,
                            browser: true,
                            os: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });

            // Filter by orderId in payload (can't do this in Prisma query easily)
            let attribution = null;

            if (purchaseEvent) {
                const payload = purchaseEvent.payload as any;
                // Check if this event matches our order
                if (payload?.orderId === order.wooId || payload?.order_id === order.wooId) {
                    const session = purchaseEvent.session;
                    attribution = {
                        firstTouchSource: session.firstTouchSource || 'direct',
                        lastTouchSource: session.lastTouchSource || 'direct',
                        utmSource: session.utmSource,
                        utmMedium: session.utmMedium,
                        utmCampaign: session.utmCampaign,
                        referrer: session.referrer,
                        country: session.country,
                        city: session.city,
                        deviceType: session.deviceType,
                        browser: session.browser,
                        os: session.os
                    };
                }
            }

            // If no match by payload, try to find by looking at all purchase events
            if (!attribution) {
                const allPurchaseEvents = await prisma.analyticsEvent.findMany({
                    where: {
                        type: 'purchase',
                        session: { accountId }
                    },
                    include: {
                        session: {
                            select: {
                                firstTouchSource: true,
                                lastTouchSource: true,
                                utmSource: true,
                                utmMedium: true,
                                utmCampaign: true,
                                referrer: true,
                                country: true,
                                city: true,
                                deviceType: true,
                                browser: true,
                                os: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 100
                });

                for (const event of allPurchaseEvents) {
                    const payload = event.payload as any;
                    if (payload?.orderId === order.wooId || payload?.order_id === order.wooId) {
                        const session = event.session;
                        attribution = {
                            firstTouchSource: session.firstTouchSource || 'direct',
                            lastTouchSource: session.lastTouchSource || 'direct',
                            utmSource: session.utmSource,
                            utmMedium: session.utmMedium,
                            utmCampaign: session.utmCampaign,
                            referrer: session.referrer,
                            country: session.country,
                            city: session.city,
                            deviceType: session.deviceType,
                            browser: session.browser,
                            os: session.os
                        };
                        break;
                    }
                }
            }

            return { attribution };
        } catch (error) {
            Logger.error('Failed to fetch order attribution', { error });
            return reply.code(500).send({ error: 'Failed to fetch order attribution' });
        }
    });

    // Remove a tag from an order
    fastify.delete<{ Params: { id: string; tag: string } }>('/:id/tags/:tag', async (request, reply) => {
        const { id } = orderIdParamSchema.parse(request.params);
        const tag = decodeURIComponent(request.params.tag);
        const accountId = request.user?.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        try {
            let order;

            // Try finding by internal UUID first
            order = await prisma.wooOrder.findUnique({ where: { id } });

            // If not found and ID is numeric, try finding by WooID
            if (!order && !isNaN(Number(id))) {
                order = await prisma.wooOrder.findUnique({
                    where: { accountId_wooId: { accountId, wooId: Number(id) } }
                });
            }

            if (!order || order.accountId !== accountId) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            // Get current rawData and remove the tag
            const rawData = order.rawData as any;
            const currentTags: string[] = rawData.tags || [];
            const newTags = currentTags.filter(t => t !== tag);

            // Update rawData with new tags
            const updatedRawData = { ...rawData, tags: newTags };

            // Update the order in PostgreSQL
            await prisma.wooOrder.update({
                where: { id: order.id },
                data: { rawData: updatedRawData }
            });

            // Reindex the order in Elasticsearch
            const { IndexingService } = await import('../services/search/IndexingService');
            await IndexingService.indexOrder(accountId, { ...updatedRawData, id: order.wooId }, newTags);

            Logger.info('Tag removed from order', { orderId: order.wooId, tag, remainingTags: newTags });

            return { success: true, tags: newTags };
        } catch (error) {
            Logger.error('Failed to remove tag from order', { error });
            return reply.code(500).send({ error: 'Failed to remove tag' });
        }
    });

    // Add a tag to an order
    fastify.post<{ Params: { id: string }; Body: { tag: string } }>('/:id/tags', async (request, reply) => {
        const { id } = orderIdParamSchema.parse(request.params);
        const { tag } = request.body as { tag: string };
        const accountId = request.user?.accountId;

        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        if (!tag || typeof tag !== 'string' || !tag.trim()) {
            return reply.code(400).send({ error: 'tag is required' });
        }

        const cleanTag = tag.trim();

        try {
            let order;

            // Try finding by internal UUID first
            order = await prisma.wooOrder.findUnique({ where: { id } });

            // If not found and ID is numeric, try finding by WooID
            if (!order && !isNaN(Number(id))) {
                order = await prisma.wooOrder.findUnique({
                    where: { accountId_wooId: { accountId, wooId: Number(id) } }
                });
            }

            if (!order || order.accountId !== accountId) {
                return reply.code(404).send({ error: 'Order not found' });
            }

            // Get current rawData and add the tag (avoid duplicates)
            const rawData = order.rawData as any;
            const currentTags: string[] = rawData.tags || [];

            if (currentTags.includes(cleanTag)) {
                return { success: true, tags: currentTags, message: 'Tag already exists' };
            }

            const newTags = [...currentTags, cleanTag];

            // Update rawData with new tags
            const updatedRawData = { ...rawData, tags: newTags };

            // Update the order in PostgreSQL
            await prisma.wooOrder.update({
                where: { id: order.id },
                data: { rawData: updatedRawData }
            });

            // Reindex the order in Elasticsearch
            const { IndexingService } = await import('../services/search/IndexingService');
            await IndexingService.indexOrder(accountId, { ...updatedRawData, id: order.wooId }, newTags);

            Logger.info('Tag added to order', { orderId: order.wooId, tag: cleanTag, allTags: newTags });

            return { success: true, tags: newTags };
        } catch (error) {
            Logger.error('Failed to add tag to order', { error });
            return reply.code(500).send({ error: 'Failed to add tag' });
        }
    });

    /**

     * Bulk update order status.
     * Updates status in WooCommerce and syncs back to local database.
     */
    fastify.put('/bulk-status', async (request, reply) => {
        const accountId = request.user?.accountId;
        if (!accountId) {
            return reply.code(400).send({ error: 'accountId header is required' });
        }

        const body = request.body as { orderIds: number[]; status: string };

        if (!body.orderIds || !Array.isArray(body.orderIds) || body.orderIds.length === 0) {
            return reply.code(400).send({ error: 'orderIds array is required' });
        }

        if (!body.status || typeof body.status !== 'string') {
            return reply.code(400).send({ error: 'status is required' });
        }

        const validStatuses = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'];
        if (!validStatuses.includes(body.status)) {
            return reply.code(400).send({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        // Limit bulk updates to prevent abuse
        if (body.orderIds.length > 50) {
            return reply.code(400).send({ error: 'Maximum 50 orders can be updated at once' });
        }

        try {
            const { WooService } = await import('../services/woo');
            const woo = await WooService.forAccount(accountId);

            // Use WooCommerce Batch API for efficient bulk update (single API call)
            const updates = body.orderIds.map(id => ({ id, status: body.status }));

            let updated = 0;
            let failed = 0;
            const errors: string[] = [];

            try {
                // Single batch API call instead of N individual calls
                const batchResult = await woo.batchUpdateOrders(updates, request.user?.id);

                // Process batch response
                if (batchResult.update) {
                    for (const result of batchResult.update) {
                        if (result.error) {
                            failed++;
                            errors.push(`Order #${result.id}: ${result.error.message}`);
                        } else {
                            updated++;
                        }
                    }
                }

                // Sync successful updates to local database
                if (updated > 0) {
                    await prisma.wooOrder.updateMany({
                        where: {
                            accountId,
                            wooId: { in: body.orderIds }
                        },
                        data: { status: body.status }
                    });
                }
            } catch (batchError: any) {
                // Fallback to individual updates if batch fails (older WooCommerce versions)
                Logger.warn('Batch API failed, falling back to individual updates', { error: batchError.message });

                for (const orderId of body.orderIds) {
                    try {
                        await woo.updateOrder(orderId, { status: body.status });
                        await prisma.wooOrder.updateMany({
                            where: { accountId, wooId: orderId },
                            data: { status: body.status }
                        });
                        updated++;
                    } catch (err: any) {
                        failed++;
                        errors.push(`Order #${orderId}: ${err.message}`);
                    }
                }
            }

            Logger.info('Bulk order status update completed', {
                accountId,
                status: body.status,
                updated,
                failed,
                total: body.orderIds.length,
                usedBatchApi: errors.length === 0
            });

            return {
                updated,
                failed,
                total: body.orderIds.length,
                errors: errors.length > 0 ? errors : undefined
            };
        } catch (error: any) {
            Logger.error('Bulk status update failed', { error: error.message });
            return reply.code(500).send({ error: 'Failed to update order statuses' });
        }
    });
};

export default ordersRoutes;
