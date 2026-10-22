import { useUser } from './useUser';
import { useAccount } from '../context/AccountContext';
import { isRecord } from '../utils/responseValidation';

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
    const { activePermissions } = useAccount();
    const permissions: Record<string, boolean> = Object.fromEntries(isRecord(activePermissions)
        ? Object.entries(activePermissions).filter(([, grant]) => grant === true || grant === false) : []);
    const granted = (key: string) => Object.prototype.hasOwnProperty.call(permissions, key) && permissions[key] === true;

    const hasPermission = (permission: string) => {
        if (!user) return false;
        if (user.isSuperAdmin === true) return true;
        // Check for wildcard access (Owner/Admin)
        if (granted('*')) return true;
        return typeof permission === 'string' && granted(permission);
    };

    return {
        hasPermission,
        permissions
    };
}
