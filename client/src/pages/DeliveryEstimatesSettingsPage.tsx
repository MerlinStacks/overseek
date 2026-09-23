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
        <div role="note" className="rounded-lg bg-amber-50 dark:bg-amber-950 p-4 text-sm text-amber-900 dark:text-amber-200">
            <p className="font-semibold">Storefront activation is explicit</p>
            <p>Save configuration in Overseek and check settings and production sync readiness below. Verified mappings and deliberate switchover are still required before serving estimates. Saving or syncing does not activate storefront output or replace your existing delivery plugin.</p>
            <p>Shipping-method discovery is separate from storefront sync; use Refresh from WooCommerce in Shipping methods to check discovery availability. Sync and activation controls are in Launch & recovery.</p>
        </div>
        {enabled ? <DeliverySettingsForm key={`${currentAccount.id}:${canEdit}`} accountId={currentAccount.id} token={token} canEdit={canEdit} canInventory={canInventory} /> : <>
            <p role="alert">Delivery estimates are disabled for this account. Contact a super admin to enable them. You can still check sync status or retry syncing the saved disabled state.</p>
            <DeliveryLaunchPanel accountId={currentAccount.id} token={token} canEdit={canEdit} canInventory={canInventory} featureEnabled={false} />
            <DeliverySyncPanel key={`${currentAccount.id}:${canEdit}`} accountId={currentAccount.id} token={token} canEdit={canEdit} />
        </>}
    </div>;
}
