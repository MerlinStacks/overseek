import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

export interface PermissionSet {
    [key: string]: boolean;
}

export class PermissionService {
    /**
     * Resolve all permissions for a user within an account.
     * Hierarchy:
     * 1. SuperAdmin -> ALL TRUE
     * 2. Owner/Admin Role -> ALL TRUE (unless specific overrides implemented later, but typically they have full access)
     * 3. Custom Role -> Defined in AccountRole.permissions
     * 4. User-Specific Overrides -> AccountUser.permissions (merges on top of role)
     */
    static async resolvePermissions(userId: string, accountId: string): Promise<PermissionSet> {
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { isSuperAdmin: true }
            });

            if (user?.isSuperAdmin) {
                return { '*': true }; // Wildcard for full access
            }

            const accountUser = await prisma.accountUser.findUnique({
                where: { userId_accountId: { userId, accountId } },
                include: { maxRole: true } // Fetch linked role
            });

            if (!accountUser) {
                return {};
            }

            // Owners and legacy Admins get full access
            if (accountUser.role === 'OWNER' || accountUser.role === 'ADMIN') {
                return { '*': true };
            }

            // Start with empty set
            let permissions: PermissionSet = {};

            // 1. Apply Role Permissions
            if (accountUser.maxRole && accountUser.maxRole.permissions) {
                const rolePerms = accountUser.maxRole.permissions as PermissionSet;
                permissions = { ...permissions, ...rolePerms };
            }

            // 2. Apply User Specific Overrides (if any)
            if (accountUser.permissions) {
                const userPerms = accountUser.permissions as PermissionSet;
                permissions = { ...permissions, ...userPerms };
            }

            return permissions;
        } catch (error) {
            Logger.error('Failed to resolve permissions', { userId, accountId, error });
            return {};
        }
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
}
