/**
 * Internal Products API Routes
 * 
 * REST endpoints for managing internal-only products that are not synced to WooCommerce.
 * 
 * @module routes/internalProducts
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { InternalProductsService } from '../services/InternalProductsService';

export default async function internalProductsRoutes(fastify: FastifyInstance) {

    // List internal products
    fastify.get('/', async (req: FastifyRequest<{
        Querystring: { search?: string; supplierId?: string; limit?: string; offset?: string }
    }>, reply: FastifyReply) => {
        const accountId = req.headers['x-account-id'] as string;

        if (!accountId) {
            return reply.status(400).send({ error: 'Account ID required' });
        }

        const { search, supplierId, limit, offset } = req.query;

        const result = await InternalProductsService.list(accountId, {
            search,
            supplierId,
            limit: limit ? parseInt(limit, 10) : undefined,
            offset: offset ? parseInt(offset, 10) : undefined
        });

        return reply.send(result);
    });

    // Get for BOM selection (lightweight list)
    fastify.get('/for-bom', async (req: FastifyRequest, reply: FastifyReply) => {
        const accountId = req.headers['x-account-id'] as string;

        if (!accountId) {
            return reply.status(400).send({ error: 'Account ID required' });
        }

        const items = await InternalProductsService.getForBOMSelection(accountId);
        return reply.send(items);
    });

    // Get single internal product
    fastify.get('/:id', async (req: FastifyRequest<{
        Params: { id: string }
    }>, reply: FastifyReply) => {
        const { id } = req.params;

        const item = await InternalProductsService.getById(id);

        if (!item) {
            return reply.status(404).send({ error: 'Internal product not found' });
        }

        return reply.send(item);
    });

    // Create internal product
    fastify.post('/', async (req: FastifyRequest<{
        Body: {
            name: string;
            sku?: string;
            description?: string;
            stockQuantity?: number;
            cogs?: number;
            binLocation?: string;
            mainImage?: string;
            images?: string[];
            supplierId?: string;
        }
    }>, reply: FastifyReply) => {
        const accountId = req.headers['x-account-id'] as string;

        if (!accountId) {
            return reply.status(400).send({ error: 'Account ID required' });
        }

        const { name, sku, description, stockQuantity, cogs, binLocation, mainImage, images, supplierId } = req.body;

        if (!name) {
            return reply.status(400).send({ error: 'Name is required' });
        }

        try {
            const item = await InternalProductsService.create(accountId, {
                name,
                sku,
                description,
                stockQuantity,
                cogs,
                binLocation,
                mainImage,
                images,
                supplierId
            });

            return reply.status(201).send(item);
        } catch (error: any) {
            if (error.message === 'Supplier not found') {
                return reply.status(400).send({ error: 'Supplier not found' });
            }
            throw error;
        }
    });

    // Update internal product
    fastify.put('/:id', async (req: FastifyRequest<{
        Params: { id: string };
        Body: {
            name?: string;
            sku?: string;
            description?: string;
            stockQuantity?: number;
            cogs?: number;
            binLocation?: string;
            mainImage?: string;
            images?: string[];
            supplierId?: string;
        }
    }>, reply: FastifyReply) => {
        const { id } = req.params;

        try {
            const item = await InternalProductsService.update(id, req.body);
            return reply.send(item);
        } catch (error: any) {
            if (error.message === 'Internal product not found') {
                return reply.status(404).send({ error: 'Internal product not found' });
            }
            if (error.message === 'Supplier not found') {
                return reply.status(400).send({ error: 'Supplier not found' });
            }
            throw error;
        }
    });

    // Delete internal product (soft check for BOM usage)
    fastify.delete('/:id', async (req: FastifyRequest<{
        Params: { id: string };
        Querystring: { force?: string }
    }>, reply: FastifyReply) => {
        const { id } = req.params;
        const force = req.query.force === 'true';

        try {
            if (force) {
                const result = await InternalProductsService.forceDelete(id);
                return reply.send(result);
            } else {
                const result = await InternalProductsService.delete(id);
                if (!result.success && result.bomUsageWarning) {
                    return reply.status(409).send({
                        error: 'Product is used in BOMs',
                        bomUsageCount: result.bomUsageWarning,
                        message: `This product is used in ${result.bomUsageWarning} BOM(s). Use ?force=true to remove from BOMs and delete.`
                    });
                }
                return reply.send(result);
            }
        } catch (error: any) {
            if (error.message === 'Internal product not found') {
                return reply.status(404).send({ error: 'Internal product not found' });
            }
            throw error;
        }
    });

    // Adjust stock quantity
    fastify.post('/:id/adjust-stock', async (req: FastifyRequest<{
        Params: { id: string };
        Body: { adjustment: number; reason: string }
    }>, reply: FastifyReply) => {
        const { id } = req.params;
        const { adjustment, reason } = req.body;

        if (typeof adjustment !== 'number') {
            return reply.status(400).send({ error: 'Adjustment must be a number' });
        }

        if (!reason) {
            return reply.status(400).send({ error: 'Reason is required' });
        }

        try {
            const item = await InternalProductsService.adjustStock(id, adjustment, reason, 'USER');
            return reply.send(item);
        } catch (error: any) {
            if (error.message === 'Internal product not found') {
                return reply.status(404).send({ error: 'Internal product not found' });
            }
            throw error;
        }
    });
}
