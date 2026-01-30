/**
 * Policies Route - Fastify Plugin
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { cacheDelete } from '../utils/cache';

interface PolicyBody {
    title?: string;
    content?: string;
    type?: string;
    category?: string | null;
    isPublished?: boolean;
}

const policiesRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // Get all policies for account
    fastify.get('/', async (request, reply) => {
        const accountId = request.user?.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            const policies = await prisma.policy.findMany({
                where: { accountId },
                orderBy: [{ type: 'asc' }, { title: 'asc' }]
            });
            return policies;
        } catch (error) {
            Logger.error('Failed to fetch policies', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch policies' });
        }
    });

    // Get single policy
    fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const accountId = request.user?.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            const policy = await prisma.policy.findFirst({
                where: { id: request.params.id, accountId }
            });
            if (!policy) return reply.code(404).send({ error: 'Policy not found' });
            return policy;
        } catch (error) {
            Logger.error('Failed to fetch policy', { error, accountId, id: request.params.id });
            return reply.code(500).send({ error: 'Failed to fetch policy' });
        }
    });

    // Create policy
    fastify.post<{ Body: PolicyBody }>('/', async (request, reply) => {
        const accountId = request.user?.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        const { title, content, type, category, isPublished } = request.body;

        if (!title) return reply.code(400).send({ error: 'Title is required' });

        try {
            const policy = await prisma.policy.create({
                data: {
                    accountId,
                    title,
                    content: content || '',
                    type: type || 'POLICY',
                    category: category || null,
                    isPublished: isPublished !== undefined ? isPublished : true
                }
            });
            await cacheDelete(`policies:${accountId}`);
            return policy;
        } catch (error) {
            Logger.error('Failed to create policy', { error, accountId, body: request.body });
            return reply.code(500).send({ error: 'Failed to create policy' });
        }
    });

    // Update policy
    fastify.put<{ Params: { id: string }; Body: PolicyBody }>('/:id', async (request, reply) => {
        const accountId = request.user?.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        const { title, content, type, category, isPublished } = request.body;

        try {
            const existing = await prisma.policy.findFirst({
                where: { id: request.params.id, accountId }
            });
            if (!existing) return reply.code(404).send({ error: 'Policy not found' });

            const policy = await prisma.policy.update({
                where: { id: request.params.id },
                data: {
                    ...(title !== undefined && { title }),
                    ...(content !== undefined && { content }),
                    ...(type !== undefined && { type }),
                    ...(category !== undefined && { category }),
                    ...(isPublished !== undefined && { isPublished })
                }
            });
            await cacheDelete(`policies:${accountId}`);
            return policy;
        } catch (error) {
            Logger.error('Failed to update policy', { error, accountId, id: request.params.id });
            return reply.code(500).send({ error: 'Failed to update policy' });
        }
    });

    // Delete policy
    fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
        const accountId = request.user?.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            const existing = await prisma.policy.findFirst({
                where: { id: request.params.id, accountId }
            });
            if (!existing) return reply.code(404).send({ error: 'Policy not found' });

            await prisma.policy.delete({
                where: { id: request.params.id }
            });
            await cacheDelete(`policies:${accountId}`);
            return { success: true };
        } catch (error) {
            Logger.error('Failed to delete policy', { error, accountId, id: request.params.id });
            return reply.code(500).send({ error: 'Failed to delete policy' });
        }
    });
};

export default policiesRoutes;
