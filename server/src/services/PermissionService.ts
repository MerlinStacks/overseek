import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { cacheDelete } from '../utils/cache';
export interface PermissionSet { [key: string]: boolean }
function grants(value: unknown): PermissionSet {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter(([key, grant]) => !['__proto__', 'constructor', 'prototype'].includes(key) && typeof grant === 'boolean')) : {};
}
const allowed = (permissions: PermissionSet, key: string) => Object.prototype.hasOwnProperty.call(permissions, key) && permissions[key] === true;
export class PermissionService {
    /** Authorization reads are deliberately uncached: revocations must not depend on Redis availability/TTL. */
    static async resolvePermissions(userId: string, accountId: string): Promise<PermissionSet> {
        if (!userId?.trim() || !accountId?.trim()) return {};
        try {
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { isSuperAdmin: true } });
            if (user?.isSuperAdmin === true) return { '*': true };
            const membership = await prisma.accountUser.findUnique({ where: { userId_accountId: { userId, accountId } }, include: { maxRole: true } });
            if (!membership) return {};
            if (membership.role === 'OWNER' || membership.role === 'ADMIN') return { '*': true };
            return { ...grants(membership.maxRole?.permissions), ...grants(membership.permissions) };
        } catch (error) { Logger.error('Failed to resolve permissions', { userId, accountId, error }); return {}; }
    }
    static async hasPermission(userId: string, accountId: string, permission: string): Promise<boolean> {
        const permissions = await this.resolvePermissions(userId, accountId); return allowed(permissions, '*') || allowed(permissions, permission);
    }
    static async hasAnyPermission(userId: string, accountId: string, keys: string[]): Promise<boolean> {
        const permissions = await this.resolvePermissions(userId, accountId); return allowed(permissions, '*') || keys.some(key => allowed(permissions, key));
    }
    /** Remove legacy cache entries; they are no longer an authority for authorization. */
    static async invalidatePermissions(userId: string, accountId: string): Promise<void> {
        try { await cacheDelete(`${userId}:${accountId}`, { namespace: 'perms' }); }
        catch { Logger.warn('Legacy permission cache cleanup unavailable', { userId, accountId }); }
    }
}
