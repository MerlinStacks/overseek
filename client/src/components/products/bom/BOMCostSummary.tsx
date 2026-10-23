import { reportMoney } from '../../analytics/useReportRequest';
import { validStock } from './bomValues';
import { workspaceStyles as ui } from '../../ui/workspaceStyles';
import { Metric, MetricStrip } from '../../ui/MetricStrip';

export interface BOMCostSummaryProps {
    totalCost: number; effectiveStock: number | null; currentWooStock: number | null; isSyncing: boolean;
    syncStatus: 'idle' | 'success' | 'error'; onSyncToWoo: () => void; currency?: string; disabled?: boolean;
}
export function BOMCostSummary({ totalCost, effectiveStock, currentWooStock, isSyncing, syncStatus, onSyncToWoo, currency, disabled }: BOMCostSummaryProps) {
    const known = validStock(effectiveStock); const wooKnown = validStock(currentWooStock);
    return <section aria-label="BOM cost and stock" className="space-y-3 text-slate-900 dark:text-slate-100">
        <MetricStrip label="BOM summary">
            <Metric label="Composite cost" value={reportMoney(totalCost >= 0 ? totalCost : NaN, currency)} valueClassName="text-emerald-800 dark:text-emerald-200" />
            <Metric label="Buildable units" value={known ? effectiveStock : 'Unavailable'} />
            <Metric label="WooCommerce stock" value={wooKnown ? currentWooStock : 'Unavailable'} />
        </MetricStrip>
        <div className="space-y-3">
            <p className={ui.badge}>{!known || !wooKnown ? 'Stock comparison unavailable' : effectiveStock === currentWooStock ? 'In sync' : 'Out of sync'}</p>
            <div><button className={ui.primary} type="button" disabled={disabled || isSyncing || !known} onClick={onSyncToWoo}>{isSyncing ? 'Syncing...' : 'Sync to WooCommerce'}</button></div>
            {syncStatus !== 'idle' && <p role={syncStatus === 'error' ? 'alert' : 'status'}>{syncStatus === 'success' ? 'Stock sync confirmed.' : 'Could not confirm stock sync. Check WooCommerce before retrying.'}</p>}
        </div>
    </section>;
}
