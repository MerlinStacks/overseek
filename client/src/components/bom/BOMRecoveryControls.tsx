import { useState } from 'react';
import type { BOMRecoveryPlan } from '../../hooks/useBOMSync';

interface Props {
    plan: BOMRecoveryPlan | null;
    error: string | null;
    loading: boolean;
    syncing: boolean;
    onReview: () => Promise<void>;
    onContinue: () => Promise<void>;
}

/** Explicit operator attestation, not an inference from an expired queue lock. */
export function BOMRecoveryControls({ plan, error, loading, syncing, onReview, onContinue }: Props) {
    const [confirmed, setConfirmed] = useState(false);
    return (
        <div className="mt-3 space-y-3 border-t border-red-200 pt-3 dark:border-red-800">
            <p className="text-sm">Continue only products proven not yet attempted. Uncertain products and their dependent BOMs stay excluded; the original failed run is kept for review.</p>
            {error && <p role="status" className="text-sm font-medium">{error}</p>}
            {!plan ? (
                <button type="button" disabled={loading || syncing} onClick={onReview} className="rounded-lg border border-current px-3 py-2 text-sm font-semibold disabled:opacity-50">
                    {loading ? 'Checking retained evidence…' : 'Review continuation'}
                </button>
            ) : (
                <>
                    <p className="text-sm"><strong>{plan.eligibleProducts}</strong> products can continue. <strong>{plan.uncertainProducts}</strong> uncertain products require review; <strong>{plan.excludedProducts}</strong> remaining targets are excluded because they changed, were removed, or depend on uncertain stock.</p>
                    {plan.eligibleProducts > 0 ? (
                        <>
                            <label className="flex items-start gap-2 text-sm">
                                <input type="checkbox" checked={confirmed} disabled={syncing} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />
                                <span>I have verified the previous worker is stopped and its outstanding WooCommerce stock requests have settled. I will keep BOM definitions unchanged during continuation. An expired lock alone is not verification.</span>
                            </label>
                            <button type="button" disabled={!confirmed || syncing} onClick={onContinue} className="rounded-lg bg-[var(--primary-color)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
                                {syncing ? 'Starting continuation…' : `Continue unaffected products (${plan.eligibleProducts})`}
                            </button>
                            <p className="text-xs">Uses freshly fetched stock. This does not reconcile excluded products or unlock normal Sync All.</p>
                        </>
                    ) : <p className="text-sm">No provably unaffected products remain. Inventory review is required.</p>}
                    <button type="button" disabled={loading || syncing} onClick={onReview} className="block text-sm font-semibold underline disabled:opacity-50">Review again</button>
                </>
            )}
        </div>
    );
}
