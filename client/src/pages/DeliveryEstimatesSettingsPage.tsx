import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { useAccountFeature } from '../hooks/useAccountFeature';
import { usePermissions } from '../hooks/usePermissions';
import { DeliverySettingsForm } from '../components/settings/deliveryEstimates/DeliverySettingsForm';

/** Account-local setup is available before the Woo companion plugin rollout. */
export function DeliveryEstimatesSettingsPage() {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const enabled = useAccountFeature('DELIVERY_ESTIMATES');
    const { hasPermission } = usePermissions();
    const canEdit = hasPermission('manage_shipping_settings');
    const canRead = hasPermission('view_shipping');
    if (!currentAccount || !token) return <p role="status">Loading account…</p>;
    if (!canRead && !canEdit) return <p role="alert">You do not have permission to view delivery settings.</p>;
    return <div className="space-y-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 text-slate-900 dark:text-slate-100">
        <h2 className="text-xl font-semibold">Delivery estimates</h2>
        <DeliverySettingsForm key={`${currentAccount.id}:${canEdit}:${canRead}:${enabled}`} accountId={currentAccount.id} token={token} canEdit={canEdit} canRead={canRead} featureEnabled={enabled} />
    </div>;
}
