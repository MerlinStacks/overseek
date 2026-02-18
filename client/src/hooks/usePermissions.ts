import { useUser } from './useUser';
import { useAccount } from '../context/AccountContext';

export interface PermissionSet {
    [key: string]: boolean;
}

/**
 * Why sourced from AccountContext: The /me endpoint returns resolved
 * permissions keyed by accountId. Reading from the React Query cache
 * (via AccountContext.activePermissions) guarantees the value is always
 * fresh — the previous approach relied on a stale-update path through
 * AuthContext that silently dropped permissions when profile fields
 * hadn't changed.
 */
export function usePermissions() {
    const { user } = useUser();
    const { activePermissions: permissions } = useAccount();

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

