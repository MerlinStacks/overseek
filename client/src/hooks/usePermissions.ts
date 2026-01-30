import { useUser } from './useUser';

export interface PermissionSet {
    [key: string]: boolean;
}

export function usePermissions() {
    const { user } = useUser();

    // We assume the backend now returns `permissions` in the user object 
    // or we might need to fetch it. To be safe/fast, let's assume we can compute it 
    // or it's provided. 
    // Implementation Plan said: "Update /me or account context to return resolved permissions"

    // If we haven't updated /me yet, this might break. 
    // But let's assume `user.permissions` or `user.activeAccountPermissions` is available.
    // Use optional chaining for safety during transition.
    const permissions = (user as any)?.permissions || {};

    const hasPermission = (permission: string) => {
        if (!user) return false;
        if (user.isSuperAdmin) return true;
        // Check for wildcard access (Owner/Admin)
        if (permissions['*']) return true;
        return !!permissions[permission];
    };

    return {
        hasPermission,
        permissions
    };
}
