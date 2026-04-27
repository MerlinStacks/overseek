/**
 * Labels Routes
 * 
 * CRUD endpoints for conversation labels/tags.
 */

import { FastifyPluginAsync } from 'fastify';
import { LabelService } from '../services/LabelService';
import { requireAuthFastify } from '../middleware/auth';
import { z } from 'zod';

const labelService = new LabelService();

// Validation schemas
const createLabelSchema = z.object({
    name: z.string().min(1).max(50),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const updateLabelSchema = z.object({
    name: z.string().min(1).max(50).optional(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const labelsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    /**
     * GET /labels - List all labels for the current account
     */
    fastify.get('/', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) {
            return reply.status(400).send({ error: 'Account ID required' });
        }
        const labels = await labelService.listLabels(accountId);
        return { labels };
    });

    /**
     * POST /labels - Create a new label
     */
    fastify.post('/', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) {
            return reply.status(400).send({ error: 'Account ID required' });
        }
        const body = createLabelSchema.parse(request.body);

        try {
            const label = await labelService.createLabel({
                accountId,
                name: body.name,
                color: body.color,
            });
            return reply.status(201).send({ label });
        } catch (error: any) {
            // Handle duplicate name error
            if (error.code === 'P2002') {
                return reply.status(409).send({ error: 'A label with this name already exists' });
            }
            throw error;
        }
    });

    /**
     * GET /labels/:id - Get a single label
     */
    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) {
            return reply.status(400).send({ error: 'Account ID required' });
        }
        const { id } = request.params;
        const label = await labelService.getLabel(accountId, id);

        if (!label) {
            return reply.status(404).send({ error: 'Label not found' });
        }

        return { label };
    });

    /**
     * PUT /labels/:id - Update a label
     */
    fastify.put<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) {
            return reply.status(400).send({ error: 'Account ID required' });
        }
        const { id } = request.params;
        const body = updateLabelSchema.parse(request.body);

        try {
            const label = await labelService.updateLabel(accountId, id, body);
            return { label };
        } catch (error: any) {
            if (error.code === 'P2025') {
                return reply.status(404).send({ error: 'Label not found' });
            }
            if (error.code === 'P2002') {
                return reply.status(409).send({ error: 'A label with this name already exists' });
            }
            throw error;
        }
    });

    /**
     * DELETE /labels/:id - Delete a label
     */
    fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) {
            return reply.status(400).send({ error: 'Account ID required' });
        }
        const { id } = request.params;

        try {
            await labelService.deleteLabel(accountId, id);
            return reply.status(204).send();
        } catch (error: any) {
            if (error.code === 'P2025') {
                return reply.status(404).send({ error: 'Label not found' });
            }
            throw error;
        }
    });
};

export default labelsRoutes;
