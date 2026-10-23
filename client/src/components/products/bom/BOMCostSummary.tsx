import { reportMoney } from '../../analytics/useReportRequest';
import { validStock } from './bomValues';
import { workspaceStyles as ui } from '../../ui/workspaceStyles';

export interface BOMCostSummaryProps {
    totalCost: number; effectiveStock: number | null; currentWooStock: number | null; isSyncing: boolean;
    syncStatus: 'idle' | 'success' | 'error'; onSyncToWoo: () => void; currency?: string; disabled?: boolean;
}
export function BOMCostSummary({ totalCost, effectiveStock, currentWooStock, isSyncing, syncStatus, onSyncToWoo, currency, disabled }: BOMCostSummaryProps) {
    const known = validStock(effectiveStock); const wooKnown = validStock(currentWooStock);
    return <section aria-label="BOM cost and stock" className="grid gap-4 md:grid-cols-2 text-slate-900 dark:text-slate-100">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/30"><h4 className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Composite cost</h4><p className="mt-2 text-2xl font-bold tabular-nums text-emerald-800 dark:text-emerald-200">{reportMoney(totalCost >= 0 ? totalCost : NaN, currency)}</p></div>
        <div className={`${ui.card} space-y-3`}><h4 className={ui.muted}>Buildable units</h4><p className="text-2xl font-bold tabular-nums">{known ? effectiveStock : 'Unavailable'}</p><p className={ui.muted}>WooCommerce stock: {wooKnown ? currentWooStock : 'Unavailable'}</p>
            <p className={ui.badge}>{!known || !wooKnown ? 'Stock comparison unavailable' : effectiveStock === currentWooStock ? 'In sync' : 'Out of sync'}</p>
            <div><button className={ui.primary} type="button" disabled={disabled || isSyncing || !known} onClick={onSyncToWoo}>{isSyncing ? 'Syncing...' : 'Sync to WooCommerce'}</button></div>
            {syncStatus !== 'idle' && <p role={syncStatus === 'error' ? 'alert' : 'status'}>{syncStatus === 'success' ? 'Stock sync confirmed.' : 'Could not confirm stock sync. Check WooCommerce before retrying.'}</p>}
        </div>
    </section>;
}
