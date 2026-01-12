/**
 * useUser Hook
 *
 * Re-exports the user object from AuthContext for convenient access.
 * This hook is used by usePermissions and other components that only need user data.
 */

import { useAuth } from '../context/AuthContext';

export function useUser() {
    const { user } = useAuth();
    return { user };
}
