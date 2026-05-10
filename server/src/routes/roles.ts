import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { requireAuthFastify } from '../middleware/auth';
import { PermissionService } from '../services/PermissionService';
import { z } from 'zod';
import { getUserAccountIdOrReply } from './routeHelpers';
import { parseFirstIssueOrReply } from './routeHelpers';

const roleSchema = z.object({
    name: z.string().min(1, "Name is required"),
    permissions: z.record(z.string(), z.boolean())
});

async function hasManageRoleAccess(userId: string, accountId: string): Promise<boolean> {
    const perms = await PermissionService.resolvePermissions(userId, accountId);
    return !!(perms['*'] || perms['manage_roles']);
}

async function getRoleForAccountOrReply(roleId: string, accountId: string, reply: any) {
    const role = await prisma.accountRole.findUnique({ where: { id: roleId } });
    if (!role || role.accountId !== accountId) {
        reply.code(404).send({ error: 'Role not found' });
        return null;
    }
    return role;
}

const rolesRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', requireAuthFastify);

    // List Roles
    fastify.get('/', async (request, reply) => {
        const accountId = getUserAccountIdOrReply(request, reply);
        if (!accountId) return;

        const canManageRoles = await hasManageRoleAccess(request.user!.id, accountId);
        if (!canManageRoles) {
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
        const accountId = getUserAccountIdOrReply(request, reply);
        if (!accountId) return;

        const canManageRoles = await hasManageRoleAccess(request.user!.id, accountId);
        if (!canManageRoles) return reply.code(403).send({ error: 'Insufficient permissions' });

        const parsedBody = parseFirstIssueOrReply<{ name: string; permissions: Record<string, boolean> }>(
            reply,
            roleSchema.safeParse(request.body),
        );
        if (!parsedBody) return;

        const { name, permissions } = parsedBody;

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
        const accountId = getUserAccountIdOrReply(request, reply);
        if (!accountId) return;
        const { roleId } = request.params as { roleId: string };

        const canManageRoles = await hasManageRoleAccess(request.user!.id, accountId);
        if (!canManageRoles) return reply.code(403).send({ error: 'Insufficient permissions' });

        const parsedBody = parseFirstIssueOrReply<{ name: string; permissions: Record<string, boolean> }>(
            reply,
            roleSchema.safeParse(request.body),
        );
        if (!parsedBody) return;

        const { name, permissions } = parsedBody;

        try {
            const existing = await getRoleForAccountOrReply(roleId, accountId, reply);
            if (!existing) return;

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
        const accountId = getUserAccountIdOrReply(request, reply);
        if (!accountId) return;
        const { roleId } = request.params as { roleId: string };

        const canManageRoles = await hasManageRoleAccess(request.user!.id, accountId);
        if (!canManageRoles) return reply.code(403).send({ error: 'Insufficient permissions' });

        try {
            const existing = await getRoleForAccountOrReply(roleId, accountId, reply);
            if (!existing) return;

            await prisma.accountRole.delete({ where: { id: roleId } });
            return { success: true };
        } catch (e) {
            return reply.code(500).send({ error: 'Failed to delete role' });
        }
    });

    // Assign Role to User
    fastify.post('/assign', async (request, reply) => {
        const accountId = getUserAccountIdOrReply(request, reply);
        if (!accountId) return;

        const canManageRoles = await hasManageRoleAccess(request.user!.id, accountId);
        if (!canManageRoles) return reply.code(403).send({ error: 'Insufficient permissions' });

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
