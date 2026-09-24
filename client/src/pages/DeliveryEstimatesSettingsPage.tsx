import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { useAccountFeature } from '../hooks/useAccountFeature';
import { usePermissions } from '../hooks/usePermissions';
import { DeliverySettingsForm } from '../components/settings/deliveryEstimates/DeliverySettingsForm';
import { DeliverySyncPanel } from '../components/settings/deliveryEstimates/DeliverySyncPanel';
import { DeliveryLaunchPanel } from '../components/settings/deliveryEstimates/DeliveryLaunchPanel';

/** Account-local setup is available before the Woo companion plugin rollout. */
export function DeliveryEstimatesSettingsPage() {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const enabled = useAccountFeature('DELIVERY_ESTIMATES');
    const { hasPermission } = usePermissions();
    const canEdit = hasPermission('manage_shipping_settings');
    const canInventory = hasPermission('manage_inventory');
    const canRead = hasPermission('view_shipping');
    if (!currentAccount || !token) return <p role="status">Loading account…</p>;
    if (!canRead && !canEdit && !canInventory) return <p role="alert">You do not have permission to view delivery settings.</p>;
    if (!canRead) return <DeliveryLaunchPanel accountId={currentAccount.id} token={token} canEdit={canEdit} canInventory={canInventory} canRead={false} featureEnabled={enabled} />;
    return <div className="space-y-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 text-slate-900 dark:text-slate-100">
        <h2 className="text-xl font-semibold">Delivery estimates</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">Set your dispatch schedule, add shipping times, then preview and enable delivery estimates. Your existing settings and product production times are used here.</p>
        {enabled ? <DeliverySettingsForm key={`${currentAccount.id}:${canEdit}`} accountId={currentAccount.id} token={token} canEdit={canEdit} canInventory={canInventory} /> : <>
            <p role="alert">Delivery estimates are disabled for this account. Contact a super admin to enable them. You can still check sync status or retry syncing the saved disabled state.</p>
            <DeliveryLaunchPanel accountId={currentAccount.id} token={token} canEdit={canEdit} canInventory={canInventory} featureEnabled={false} />
            <DeliverySyncPanel key={`${currentAccount.id}:${canEdit}`} accountId={currentAccount.id} token={token} canEdit={canEdit} />
        </>}
    </div>;
}
