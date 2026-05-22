import { useState, type ReactNode } from 'react';
import { Ban, FileText, RefreshCcw, Printer, Receipt } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import { ShippingComingSoonCard, ShippingPageShell } from './ShippingPageShell';
import { openShippingLabelPdf, shippingFetch, type ShippingCarrierTransaction, type ShippingLabelRecord, type ShippingSettingsResponse } from './shippingApi';

type LabelsTab = 'labels' | 'invoices';

export function ShippingLabelsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [activeTab, setActiveTab] = useState<LabelsTab>('labels');
    const canFetch = Boolean(token && currentAccount?.id);

    const labelsQuery = useApiQuery<{ labels: ShippingLabelRecord[] }>({
        queryKey: ['shipping-labels', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/labels?limit=100', token!, currentAccount!.id),
    });
    const transactionsQuery = useApiQuery<{ transactions: ShippingCarrierTransaction[] }>({
        queryKey: ['shipping-transactions', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/transactions?limit=100', token!, currentAccount!.id),
    });
    const settingsQuery = useApiQuery<ShippingSettingsResponse>({
        queryKey: ['shipping-settings', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/settings', token!, currentAccount!.id),
    });
    const reprintLabel = useApiMutation<{ printJob: unknown }, string>({
        invalidateQueries: [['shipping-labels', currentAccount?.id]],
        mutationFn: (labelId) => shippingFetch(`/labels/${labelId}/reprint`, token!, currentAccount!.id, {
            method: 'POST',
            body: JSON.stringify({}),
        }),
    });
    const cancelLabel = useApiMutation<{ label: ShippingLabelRecord }, string>({
        invalidateQueries: [['shipping-labels', currentAccount?.id], ['shipping-audit-events', currentAccount?.id]],
        mutationFn: (labelId) => shippingFetch(`/labels/${labelId}/cancel`, token!, currentAccount!.id, {
            method: 'POST',
            body: JSON.stringify({ reason: 'Cancelled from Past Labels / Invoices' }),
        }),
    });
    const recoverPendingPdf = useApiMutation<{ label: ShippingLabelRecord }, string>({
        invalidateQueries: [['shipping-labels', currentAccount?.id], ['shipping-print-jobs', currentAccount?.id], ['shipping-audit-events', currentAccount?.id]],
        mutationFn: (labelId) => shippingFetch(`/labels/${labelId}/recover-pdf`, token!, currentAccount!.id, {
            method: 'POST',
            body: JSON.stringify({ queuePrint: settingsQuery.data?.carrierAccount?.config?.printDeliveryMethod !== 'open_pdf' }),
        }),
        onSuccess: (data) => {
            if (settingsQuery.data?.carrierAccount?.config?.printDeliveryMethod === 'open_pdf') {
                void openShippingLabelPdf(data.label.id, token!, currentAccount!.id);
            }
        },
    });
    const retryFulfillment = useApiMutation<{ label: ShippingLabelRecord }, string>({
        invalidateQueries: [['shipping-labels', currentAccount?.id], ['shipping-audit-events', currentAccount?.id]],
        mutationFn: (labelId) => shippingFetch(`/labels/${labelId}/retry-fulfillment`, token!, currentAccount!.id, {
            method: 'POST',
            body: JSON.stringify({}),
        }),
    });

    const fulfillmentBehavior = String(settingsQuery.data?.carrierAccount?.config?.wooFulfillmentBehavior || 'print_success');
    const opensPdfOnScreen = settingsQuery.data?.carrierAccount?.config?.printDeliveryMethod === 'open_pdf';
    const syncHint = fulfillmentBehavior === 'keep_in_dispatch'
        ? 'Auto-complete is disabled. Orders remain in dispatch until manually completed.'
        : fulfillmentBehavior === 'label_created'
            ? 'Auto-complete runs when labels are created or recovered.'
            : 'Auto-complete runs after successful print and Woo sync.';

    return (
        <ShippingPageShell
            title="Past Labels / Invoices"
            description="Reprint locally stored labels from the last 30 days and review MyPost Business transaction records."
        >
            <ShippingComingSoonCard>
                <div className="mb-5 flex flex-wrap gap-2">
                    <TabButton active={activeTab === 'labels'} onClick={() => setActiveTab('labels')} icon={<FileText size={16} />} label="Past Labels" />
                    <TabButton active={activeTab === 'invoices'} onClick={() => setActiveTab('invoices')} icon={<Receipt size={16} />} label="Invoices" />
                </div>

                {activeTab === 'labels' ? (
                    <div>
                        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{syncHint}</p>
                        {labelsQuery.isLoading ? <p className="text-sm text-slate-500">Loading labels...</p> : null}
                        {labelsQuery.error ? <p className="text-sm text-red-600">{labelsQuery.error.message}</p> : null}
                        {reprintLabel.error ? <p className="mb-3 text-sm text-red-600">{reprintLabel.error.message}</p> : null}
                        {cancelLabel.error ? <p className="mb-3 text-sm text-red-600">{cancelLabel.error.message}</p> : null}
                        {recoverPendingPdf.error ? <p className="mb-3 text-sm text-red-600">{recoverPendingPdf.error.message}</p> : null}
                        {retryFulfillment.error ? <p className="mb-3 text-sm text-red-600">{retryFulfillment.error.message}</p> : null}
                        {(labelsQuery.data?.labels.length || 0) === 0 && !labelsQuery.isLoading ? <p className="text-sm text-slate-500 dark:text-slate-400">No labels have been created yet.</p> : null}
                        <div className="space-y-3">
                            {labelsQuery.data?.labels.map((label) => {
                                const storedUntil = label.labelStoredUntil ? new Date(label.labelStoredUntil) : null;
                                const canReprint = Boolean(label.labelFilePath && storedUntil && storedUntil > new Date());
                                const canCancel = !label.cancelledAt && !['cancelled', 'printed', 'fulfilled', 'delivered', 'returned'].includes(label.status);
                                const canRecoverPdf = !label.cancelledAt && ['label_pending_pdf', 'created', 'label_requested'].includes(label.status);
                                const canRetryFulfillment = !label.cancelledAt && label.status === 'printed';
                                return (
                                    <div key={label.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                            <div>
                                                <p className="font-semibold text-slate-900 dark:text-white">Order #{label.wooOrderId}</p>
                                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{label.serviceName || label.carrier} · {label.trackingNumber || 'No tracking number yet'}</p>
                                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Created {new Date(label.createdAt).toLocaleString()} · Stored until {storedUntil ? storedUntil.toLocaleDateString() : 'not set'}</p>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-200">{label.status}</span>
                                                <span className={`rounded-full px-2 py-1 text-xs font-semibold uppercase ${canReprint ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'}`}>{canReprint ? 'stored locally' : 'not reprintable'}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (window.confirm('Request cancellation for this AusPost label?')) cancelLabel.mutate(label.id);
                                                    }}
                                                    disabled={!canCancel || cancelLabel.isPending}
                                                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                                                >
                                                    <Ban size={14} /> Cancel
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => recoverPendingPdf.mutate(label.id)}
                                                    disabled={!canRecoverPdf || recoverPendingPdf.isPending}
                                                    className="inline-flex items-center gap-2 rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10"
                                                >
                                                    <RefreshCcw size={14} /> Recover PDF
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => retryFulfillment.mutate(label.id)}
                                                    disabled={!canRetryFulfillment || retryFulfillment.isPending}
                                                    className="inline-flex items-center gap-2 rounded-lg border border-sky-200 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-500/40 dark:text-sky-300 dark:hover:bg-sky-500/10"
                                                >
                                                    <RefreshCcw size={14} /> Retry Woo Sync
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => opensPdfOnScreen ? void openShippingLabelPdf(label.id, token!, currentAccount!.id) : reprintLabel.mutate(label.id)}
                                                    disabled={!canReprint || reprintLabel.isPending}
                                                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    <Printer size={14} /> {opensPdfOnScreen ? 'Open PDF' : 'Reprint'}
                                                </button>
                                            </div>
                                        </div>
                                        {label.errorMessage ? <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{label.errorMessage}</p> : null}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div>
                        {transactionsQuery.isLoading ? <p className="text-sm text-slate-500">Loading transactions...</p> : null}
                        {transactionsQuery.error ? <p className="text-sm text-red-600">{transactionsQuery.error.message}</p> : null}
                        {(transactionsQuery.data?.transactions.length || 0) === 0 && !transactionsQuery.isLoading ? <p className="text-sm text-slate-500 dark:text-slate-400">No MyPost Business transactions have been synced yet.</p> : null}
                        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                                    <tr>
                                        <th className="px-4 py-3">Date</th>
                                        <th className="px-4 py-3">Reference</th>
                                        <th className="px-4 py-3">Service</th>
                                        <th className="px-4 py-3">Amount</th>
                                        <th className="px-4 py-3">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                    {transactionsQuery.data?.transactions.map((transaction) => (
                                        <tr key={transaction.id}>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{new Date(transaction.transactionDate).toLocaleDateString()}</td>
                                            <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{transaction.reference || transaction.transactionId}</td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{transaction.serviceName || transaction.serviceCode || '-'}</td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{transaction.currency || 'AUD'} {transaction.amount ?? '-'}</td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{transaction.status || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </ShippingComingSoonCard>
        </ShippingPageShell>
    );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'}`}
        >
            {icon} {label}
        </button>
    );
}
