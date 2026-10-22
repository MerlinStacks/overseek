import { Fragment, type ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import type { ShippingScope } from './shippingWorkspace';
export function ShippingBoundary({ children }: { children: (scope: ShippingScope) => ReactNode }) {
    const { token, user } = useAuth(), { currentAccount } = useAccount(), { hasPermission } = usePermissions();
    if (!token || !user?.id || !currentAccount || !hasPermission('view_shipping')) return <p role="alert">Select an account with current shipping read access.</p>;
    return <Fragment key={JSON.stringify([user.id, token, currentAccount.id])}>{children({ token, accountId: currentAccount.id, actorId: user.id })}</Fragment>;
}
export function ShippingReadState({ loading, retry }: { loading?: boolean; retry: () => void }) { return loading ? <p role="status">Loading scoped shipping observations…</p> : <p role="alert">Shipping observations unavailable. <button type="button" onClick={retry}>Retry read</button></p>; }
