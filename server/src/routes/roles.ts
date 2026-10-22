import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { requireAuthFastify } from '../middleware/auth';
import { PermissionService } from '../services/PermissionService';
import { z } from 'zod';
const id = z.string().trim().min(1).max(200);
const roleSchema = z.object({ name: z.string().trim().min(1).max(100), permissions: z.record(z.string().regex(/^(\*|[a-z][a-z0-9_]{0,79})$/).refine(key => !['constructor', 'prototype', '__proto__'].includes(key)), z.boolean()).refine(map => Object.keys(map).length <= 100) }).strict();
const assignSchema = z.object({ targetUserId: id, roleId: id.nullable() }).strict();
const rolesRoutes: FastifyPluginAsync = async fastify => {
    fastify.addHook('preHandler', requireAuthFastify);
    fastify.addHook('preHandler', async (request, reply) => {
        if (!request.accountId || !request.user?.id) return reply.code(400).send({ error: 'Select an account' });
        if (!await PermissionService.hasPermission(request.user.id, request.accountId, 'manage_roles')) return reply.code(403).send({ error: 'Role management permission required' });
    });
    fastify.get('/', async request => prisma.accountRole.findMany({ where: { accountId: request.accountId }, orderBy: { name: 'asc' }, take: 500, include: { _count: { select: { users: true } } } }));
    fastify.post('/', async (request, reply) => {
        const parsed = roleSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: 'Invalid role name or permission map' });
        try { return await prisma.accountRole.create({ data: { accountId: request.accountId!, ...parsed.data } }); }
        catch (error) { return reply.code((error as { code?: string }).code === 'P2002' ? 409 : 500).send({ error: 'Could not create role' }); }
    });
    for (const method of ['PUT', 'DELETE'] as const) fastify.route<{ Params: { roleId: string } }>({ method, url: '/:roleId', handler: async (request, reply) => {
        const roleId = id.safeParse(request.params.roleId); if (!roleId.success) return reply.code(400).send({ error: 'Invalid role ID' });
        const body = method === 'PUT' ? roleSchema.safeParse(request.body) : null;
        if (body && !body.success) return reply.code(400).send({ error: 'Invalid role' });
        const accountId = request.accountId!;
        try {
            const result = await prisma.$transaction(async tx => {
                await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`roles:${accountId}`}, 0))`;
                const role = await tx.accountRole.findFirst({ where: { id: roleId.data, accountId } });
                if (!role) return { status: 404 as const };
                const users = await tx.accountUser.findMany({ where: { accountId, roleId: role.id }, select: { userId: true } });
                if (method === 'DELETE' && users.length) return { status: 409 as const };
                if (method === 'DELETE') await tx.accountRole.deleteMany({ where: { id: role.id, accountId } });
                else if (body?.success) await tx.accountRole.updateMany({ where: { id: role.id, accountId }, data: body.data });
                return { status: 200 as const, users, role: method === 'PUT' ? await tx.accountRole.findFirst({ where: { id: role.id, accountId } }) : null };
            });
            if (result.status !== 200) return reply.code(result.status).send({ error: result.status === 404 ? 'Role not found' : 'Unassign users before deleting this role' });
            await Promise.all(result.users.map(user => PermissionService.invalidatePermissions(user.userId, accountId)));
            return result.role ?? { success: true };
        } catch (error) { return reply.code((error as { code?: string }).code === 'P2002' ? 409 : 500).send({ error: 'Could not change role' }); }
    } });
    fastify.post('/assign', async (request, reply) => {
        const body = assignSchema.safeParse(request.body); if (!body.success) return reply.code(400).send({ error: 'Invalid role assignment' });
        const accountId = request.accountId!, { targetUserId, roleId } = body.data;
        const status = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`roles:${accountId}`}, 0))`;
            if (roleId && !await tx.accountRole.findFirst({ where: { id: roleId, accountId } })) return 400;
            const result = await tx.accountUser.updateMany({ where: { userId: targetUserId, accountId }, data: { roleId } });
            return result.count === 1 ? 200 : 404;
        });
        if (status !== 200) return reply.code(status).send({ error: status === 400 ? 'Invalid role' : 'User not found in account' });
        await PermissionService.invalidatePermissions(targetUserId, accountId);
        return { success: true };
    });
};
export default rolesRoutes;
