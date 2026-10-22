import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { assertEmailDesign, createDefaultEmailDesignV2 } from '@overseek/core';
import { prisma } from '../utils/prisma';
import { PermissionService } from '../services/PermissionService';
import { publishEmailAsset } from '../services/EmailAssetService';

const presetSchema = z.object({ name: z.string().trim().min(1).max(120), section: z.any(), version: z.number().int().positive().optional() });
export const marketingDesignerRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
        if (!await PermissionService.hasPermission(request.user.id, request.accountId, request.method === 'GET' ? 'view_marketing' : 'manage_marketing')) return reply.code(403).send({ error: 'Marketing permission required' });
    });
    fastify.post('/designer/assets', async (request, reply) => {
        const file = await request.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
        if (!file) return reply.code(400).send({ error: 'Choose an image' });
        try { const bytes = await file.toBuffer(); if (file.file.truncated) throw new Error('Image exceeds 5 MB'); return await publishEmailAsset(request.accountId!, bytes); }
        catch { return reply.code(400).send({ error: 'Could not publish this image. Use a raster image under 5 MB and configure a public HTTPS asset origin.' }); }
    });
    fastify.get('/designer/sections', async request => {
        const presets = await prisma.emailSectionPreset.findMany({ where: { accountId: request.accountId! }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 101 });
        return { presets: presets.slice(0, 100), hasMore: presets.length > 100 };
    });
    for (const method of ['POST', 'PUT'] as const) fastify.route<{ Params: { id?: string } }>({ method, url: method === 'POST' ? '/designer/sections' : '/designer/sections/:id', bodyLimit: 1024 * 1024, handler: async (request, reply) => {
        const parsed = presetSchema.safeParse(request.body);
        if (!parsed.success || method === 'PUT' && !parsed.data.version) return reply.code(400).send({ error: 'Invalid section or revision' });
        const design = createDefaultEmailDesignV2(); design.document.sections = [parsed.data.section];
        try { assertEmailDesign(design); } catch { return reply.code(400).send({ error: 'Invalid section design' }); }
        if (method === 'POST') return prisma.emailSectionPreset.create({ data: { accountId: request.accountId!, name: parsed.data.name, section: parsed.data.section } });
        const changed = await prisma.emailSectionPreset.updateMany({ where: { id: request.params.id!, accountId: request.accountId!, version: parsed.data.version }, data: { name: parsed.data.name, section: parsed.data.section, version: { increment: 1 } } });
        if (!changed.count) return reply.code(409).send({ error: 'Library source changed. Refresh the library before updating it.' });
        return { id: request.params.id, name: parsed.data.name, section: parsed.data.section, version: parsed.data.version! + 1 };
    } });
};
