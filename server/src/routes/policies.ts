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

    // Get AI prompts for account (with fallback to global defaults)
    fastify.get('/ai-prompts', async (request, reply) => {
        const accountId = request.user?.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            const [globalPrompts, accountPrompts] = await Promise.all([
                prisma.aIPrompt.findMany({ orderBy: { promptId: 'asc' } }),
                prisma.accountAIPrompt.findMany({ where: { accountId }, orderBy: { promptId: 'asc' } })
            ]);

            const byPromptId = new Map(globalPrompts.map(p => [p.promptId, {
                id: p.promptId,
                name: p.name,
                content: p.content,
                updatedAt: p.updatedAt,
                isAccountOverride: false
            }]));

            for (const p of accountPrompts) {
                byPromptId.set(p.promptId, {
                    id: p.promptId,
                    name: p.name,
                    content: p.content,
                    updatedAt: p.updatedAt,
                    isAccountOverride: true
                });
            }

            return Array.from(byPromptId.values()).sort((a, b) => a.id.localeCompare(b.id));
        } catch (error) {
            Logger.error('Failed to fetch AI prompts', { error, accountId });
            return reply.code(500).send({ error: 'Failed to fetch AI prompts' });
        }
    });

    // Upsert account-level AI prompt override
    fastify.put<{ Params: { promptId: string }; Body: { content?: string; name?: string } }>('/ai-prompts/:promptId', async (request, reply) => {
        const accountId = request.user?.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        const { promptId } = request.params;
        const { content, name } = request.body;

        if (!content?.trim()) {
            return reply.code(400).send({ error: 'Content is required' });
        }

        try {
            const saved = await prisma.accountAIPrompt.upsert({
                where: {
                    accountId_promptId: { accountId, promptId }
                },
                update: { content: content.trim(), name },
                create: { accountId, promptId, content: content.trim(), name }
            });

            return {
                id: saved.promptId,
                name: saved.name,
                content: saved.content,
                updatedAt: saved.updatedAt,
                isAccountOverride: true
            };
        } catch (error) {
            Logger.error('Failed to save account AI prompt', { error, accountId, promptId });
            return reply.code(500).send({ error: 'Failed to save AI prompt' });
        }
    });

    // Delete account-level AI prompt override (reverts to global default)
    fastify.delete<{ Params: { promptId: string } }>('/ai-prompts/:promptId', async (request, reply) => {
        const accountId = request.user?.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        const { promptId } = request.params;

        try {
            await prisma.accountAIPrompt.deleteMany({
                where: { accountId, promptId }
            });
            return { success: true };
        } catch (error) {
            Logger.error('Failed to delete account AI prompt override', { error, accountId, promptId });
            return reply.code(500).send({ error: 'Failed to reset AI prompt' });
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
