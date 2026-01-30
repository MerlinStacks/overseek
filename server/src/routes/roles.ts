import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { requireAuthFastify } from '../middleware/auth';
import { PermissionService } from '../services/PermissionService';
import { z } from 'zod';

const roleSchema = z.object({
    name: z.string().min(1, "Name is required"),
    permissions: z.record(z.string(), z.boolean())
});

const rolesRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // List Roles
    fastify.get('/', async (request, reply) => {
        const accountId = request.user!.accountId!; // Guaranteed by requireAuthFastify for account routes? No, need to check if route is strict.

        // This plugin should likely be registered under a prefix that ensures account context or we check it.
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const canView = await PermissionService.hasPermission(request.user!.id, accountId, 'manage_roles');
        if (!canView) {
            // Check if they are admin/owner via legacy role
            // PermissionService handles this internally but hasPermission checks specific flag.
            // We should ensure admins always have 'manage_roles' implicitly in hasPermission.
            // PermissionService.resolvePermissions handles owner/admin -> permissions['*'] = true.
        }

        // Actually, if they don't have permission we might deny. 
        // But maybe we want listing for assignment? Let's check permissions.
        const perms = await PermissionService.resolvePermissions(request.user!.id, accountId);
        if (!perms['*'] && !perms['manage_roles']) {
            return reply.code(403).send({ error: 'Insufficient permissions' });
        }

        const roles = await prisma.accountRole.findMany({
            where: { accountId },
            orderBy: { name: 'asc' },
            include: { _count: { select: { users: true } } }
        });

        return roles;
    });

    // Create Role
    fastify.post('/', async (request, reply) => {
        const accountId = request.user!.accountId!;
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const perms = await PermissionService.resolvePermissions(request.user!.id, accountId);
        if (!perms['*'] && !perms['manage_roles']) return reply.code(403).send({ error: 'Insufficient permissions' });

        const parsed = roleSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

        const { name, permissions } = parsed.data;

        try {
            const role = await prisma.accountRole.create({
                data: {
                    accountId,
                    name,
                    permissions: permissions as any
                }
            });
            return role;
        } catch (e) {
            return reply.code(400).send({ error: 'Role name likely already exists' });
        }
    });

    // Update Role
    fastify.put('/:roleId', async (request, reply) => {
        const accountId = request.user!.accountId!;
        const { roleId } = request.params as { roleId: string };

        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const perms = await PermissionService.resolvePermissions(request.user!.id, accountId);
        if (!perms['*'] && !perms['manage_roles']) return reply.code(403).send({ error: 'Insufficient permissions' });

        const parsed = roleSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

        const { name, permissions } = parsed.data;

        try {
            // Verify ownership
            const existing = await prisma.accountRole.findUnique({ where: { id: roleId } });
            if (!existing || existing.accountId !== accountId) return reply.code(404).send({ error: 'Role not found' });

            const role = await prisma.accountRole.update({
                where: { id: roleId },
                data: { name, permissions: permissions as any }
            });
            return role;
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to update role' });
        }
    });

    // Delete Role
    fastify.delete('/:roleId', async (request, reply) => {
        const accountId = request.user!.accountId!;
        const { roleId } = request.params as { roleId: string };

        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const perms = await PermissionService.resolvePermissions(request.user!.id, accountId);
        if (!perms['*'] && !perms['manage_roles']) return reply.code(403).send({ error: 'Insufficient permissions' });

        try {
            const existing = await prisma.accountRole.findUnique({ where: { id: roleId } });
            if (!existing || existing.accountId !== accountId) return reply.code(404).send({ error: 'Role not found' });

            await prisma.accountRole.delete({ where: { id: roleId } });
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to delete role' });
        }
    });

    // Assign Role to User
    fastify.post('/assign', async (request, reply) => {
        const accountId = request.user!.accountId!;
        if (!accountId) return reply.code(400).send({ error: 'Account context required' });

        const perms = await PermissionService.resolvePermissions(request.user!.id, accountId);
        if (!perms['*'] && !perms['manage_roles']) return reply.code(403).send({ error: 'Insufficient permissions' });

        const { targetUserId, roleId } = request.body as { targetUserId: string, roleId: string | null };

        try {
            // Check if user is in account
            const accountUser = await prisma.accountUser.findUnique({
                where: { userId_accountId: { userId: targetUserId, accountId } }
            });

            if (!accountUser) return reply.code(404).send({ error: 'User not found in account' });

            // If roleId is provided, verify it exists and belongs to account
            if (roleId) {
                const role = await prisma.accountRole.findUnique({ where: { id: roleId } });
                if (!role || role.accountId !== accountId) return reply.code(400).send({ error: 'Invalid role' });
            }

            await prisma.accountUser.update({
                where: { userId_accountId: { userId: targetUserId, accountId } },
                data: { roleId }
            });

            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to assign role' });
        }
    });
};

export default rolesRoutes;
