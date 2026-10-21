import { reportMoney } from '../../analytics/useReportRequest';
import { validStock } from './bomValues';

export interface BOMCostSummaryProps {
    totalCost: number; effectiveStock: number | null; currentWooStock: number | null; isSyncing: boolean;
    syncStatus: 'idle' | 'success' | 'error'; onSyncToWoo: () => void; currency?: string; disabled?: boolean;
}
export function BOMCostSummary({ totalCost, effectiveStock, currentWooStock, isSyncing, syncStatus, onSyncToWoo, currency, disabled }: BOMCostSummaryProps) {
    const known = validStock(effectiveStock); const wooKnown = validStock(currentWooStock);
    return <section aria-label="BOM cost and stock" className="grid gap-4 md:grid-cols-2 text-slate-900 dark:text-slate-100">
        <div className="p-4 rounded-xl bg-green-50 dark:bg-green-950"><h4>Composite cost</h4><p>{reportMoney(totalCost >= 0 ? totalCost : NaN, currency)}</p></div>
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 space-y-2"><h4>Buildable units</h4><p>{known ? effectiveStock : 'Unavailable'}</p><p>WooCommerce stock: {wooKnown ? currentWooStock : 'Unavailable'}</p>
            <p>{!known || !wooKnown ? 'Stock comparison unavailable' : effectiveStock === currentWooStock ? 'In sync' : 'Out of sync'}</p>
            <button type="button" disabled={disabled || isSyncing || !known} onClick={onSyncToWoo}>{isSyncing ? 'Syncing...' : 'Sync to WooCommerce'}</button>
            {syncStatus !== 'idle' && <p role={syncStatus === 'error' ? 'alert' : 'status'}>{syncStatus === 'success' ? 'Stock sync confirmed.' : 'Could not confirm stock sync. Check WooCommerce before retrying.'}</p>}
        </div>
    </section>;
}
