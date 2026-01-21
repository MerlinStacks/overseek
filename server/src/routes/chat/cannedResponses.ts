/**
 * Canned Responses Routes
 * 
 * Handles canned response templates and labels for the inbox.
 * Extracted from chat.ts for maintainability.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma';
import { requireAuthFastify } from '../../middleware/auth';

export const cannedResponseRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // --- Canned Response Labels ---
    fastify.get('/canned-labels', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return [];
        const labels = await prisma.cannedResponseLabel.findMany({
            where: { accountId },
            orderBy: { name: 'asc' }
        });
        return labels;
    });

    fastify.post('/canned-labels', async (request, reply) => {
        const { name, color } = request.body as any;
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
        if (!name?.trim()) return reply.code(400).send({ error: 'Name is required' });

        try {
            const label = await prisma.cannedResponseLabel.create({
                data: { name: name.trim(), color: color || '#6366f1', accountId }
            });
            return label;
        } catch (error: any) {
            if (error.code === 'P2002') {
                return reply.code(409).send({ error: 'A label with this name already exists' });
            }
            throw error;
        }
    });

    fastify.put<{ Params: { id: string } }>('/canned-labels/:id', async (request, reply) => {
        const { name, color } = request.body as any;
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        try {
            const label = await prisma.cannedResponseLabel.update({
                where: { id: request.params.id },
                data: {
                    ...(name && { name: name.trim() }),
                    ...(color && { color })
                }
            });
            return label;
        } catch (error: any) {
            if (error.code === 'P2002') {
                return reply.code(409).send({ error: 'A label with this name already exists' });
            }
            if (error.code === 'P2025') {
                return reply.code(404).send({ error: 'Label not found' });
            }
            throw error;
        }
    });

    fastify.delete<{ Params: { id: string } }>('/canned-labels/:id', async (request, reply) => {
        try {
            await prisma.cannedResponseLabel.delete({ where: { id: request.params.id } });
            return { success: true };
        } catch (error: any) {
            if (error.code === 'P2025') {
                return reply.code(404).send({ error: 'Label not found' });
            }
            throw error;
        }
    });

    // --- Canned Responses ---
    fastify.get('/canned-responses', async (request, reply) => {
        const accountId = request.accountId;
        if (!accountId) return [];
        const responses = await prisma.cannedResponse.findMany({
            where: { accountId },
            include: { label: true },
            orderBy: [{ shortcut: 'asc' }]
        });
        return responses;
    });

    fastify.post('/canned-responses', async (request, reply) => {
        const { shortcut, content, labelId } = request.body as any;
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });
        const resp = await prisma.cannedResponse.create({
            data: { shortcut, content, labelId: labelId || null, accountId },
            include: { label: true }
        });
        return resp;
    });

    fastify.put<{ Params: { id: string } }>('/canned-responses/:id', async (request, reply) => {
        const { shortcut, content, labelId } = request.body as any;
        const accountId = request.accountId;
        if (!accountId) return reply.code(400).send({ error: 'Account ID required' });

        const resp = await prisma.cannedResponse.update({
            where: { id: request.params.id },
            data: { shortcut, content, labelId: labelId || null },
            include: { label: true }
        });
        return resp;
    });

    fastify.delete<{ Params: { id: string } }>('/canned-responses/:id', async (request, reply) => {
        await prisma.cannedResponse.delete({ where: { id: request.params.id } });
        return { success: true };
    });
};
