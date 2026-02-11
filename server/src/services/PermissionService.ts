import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { cacheAside, CacheTTL, cacheDelete } from '../utils/cache';

export interface PermissionSet {
    [key: string]: boolean;
}

/** Why namespace: permission lookups are hot-path, separate from other cache entries */
const PERM_NAMESPACE = 'perms';

export class PermissionService {
    /**
     * Resolve all permissions for a user within an account.
     * Results are cached in Redis for 2 minutes to avoid repeated DB hits
     * on dashboard loads that trigger many RBAC checks in parallel.
     *
     * Hierarchy:
     * 1. SuperAdmin -> ALL TRUE
     * 2. Owner/Admin Role -> ALL TRUE
     * 3. Custom Role -> Defined in AccountRole.permissions
     * 4. User-Specific Overrides -> AccountUser.permissions (merges on top of role)
     */
    static async resolvePermissions(userId: string, accountId: string): Promise<PermissionSet> {
        return cacheAside(
            `${userId}:${accountId}`,
            async () => {
                try {
                    const user = await prisma.user.findUnique({
                        where: { id: userId },
                        select: { isSuperAdmin: true }
                    });

                    if (user?.isSuperAdmin) {
                        return { '*': true };
                    }

                    const accountUser = await prisma.accountUser.findUnique({
                        where: { userId_accountId: { userId, accountId } },
                        include: { maxRole: true }
                    });

                    if (!accountUser) {
                        return {};
                    }

                    if (accountUser.role === 'OWNER' || accountUser.role === 'ADMIN') {
                        return { '*': true };
                    }

                    let permissions: PermissionSet = {};

                    if (accountUser.maxRole && accountUser.maxRole.permissions) {
                        const rolePerms = accountUser.maxRole.permissions as PermissionSet;
                        permissions = { ...permissions, ...rolePerms };
                    }

                    if (accountUser.permissions) {
                        const userPerms = accountUser.permissions as PermissionSet;
                        permissions = { ...permissions, ...userPerms };
                    }

                    return permissions;
                } catch (error) {
                    Logger.error('Failed to resolve permissions', { userId, accountId, error });
                    return {};
                }
            },
            { ttl: CacheTTL.DASHBOARD, namespace: PERM_NAMESPACE }
        );
    }

    /**
     * Check if a user has a specific permission.
     * Handles wildcard '*' access.
     */
    static async hasPermission(userId: string, accountId: string, permission: string): Promise<boolean> {
        const perms = await this.resolvePermissions(userId, accountId);
        if (perms['*']) return true;
        return !!perms[permission];
    }

    /**
     * Bust the permission cache for a user+account pair.
     * Call this when roles or permissions are modified.
     */
    static async invalidatePermissions(userId: string, accountId: string): Promise<void> {
        await cacheDelete(`${userId}:${accountId}`, { namespace: PERM_NAMESPACE });
    }
}
