import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, PackageCheck, Printer, Save, Truck, X } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import { serviceCodeNaturalLabel } from './auspostServiceCatalog';
import { ShippingComingSoonCard, ShippingPageShell } from './ShippingPageShell';
import { gramsToKg, mmToCm, openShippingLabelPdf, shippingFetch, type AusPostServiceCatalogResponse, type ShippingBulkLabelResult, type ShippingDispatchOrder, type ShippingHubSummary, type ShippingPackagePreset, type ShippingSettingsResponse } from './shippingApi';

type QueueFilter = 'all' | 'ready' | 'attention';
type QueueSort = 'oldest' | 'newest' | 'order' | 'customer';

interface DraftFormState {
    wooOrderId: number;
    address1: string;
    address2: string;
    suburb: string;
    state: string;
    postcode: string;
    country: string;
}

export function ShippingHubPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [selectedOrders, setSelectedOrders] = useState<number[]>([]);
    const [bulkResult, setBulkResult] = useState<ShippingBulkLabelResult | null>(null);
    const [draftForm, setDraftForm] = useState<DraftFormState | null>(null);
    const [addressValidationDraft, setAddressValidationDraft] = useState<ShippingDispatchOrder['draft'] | null>(null);
    const [rateOrderId, setRateOrderId] = useState<number | null>(null);
    const [manualPrintOrderId, setManualPrintOrderId] = useState<number | null>(null);
    const [queueSearch, setQueueSearch] = useState('');
    const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
    const [queueSort, setQueueSort] = useState<QueueSort>('oldest');
    const canFetch = Boolean(token && currentAccount?.id);

    const hubQuery = useApiQuery<ShippingHubSummary>({
        queryKey: ['shipping-hub', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/hub', token!, currentAccount!.id),
    });
    const ordersQuery = useApiQuery<{ dispatchStatus: string; orders: ShippingDispatchOrder[] }>({
        queryKey: ['shipping-orders', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/orders?limit=100', token!, currentAccount!.id),
    });
    const packagesQuery = useApiQuery<{ packages: ShippingPackagePreset[] }>({
        queryKey: ['shipping-packages', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/packages', token!, currentAccount!.id),
    });
    const settingsQuery = useApiQuery<ShippingSettingsResponse>({
        queryKey: ['shipping-settings', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/settings', token!, currentAccount!.id),
    });
    const serviceCatalogQuery = useApiQuery<AusPostServiceCatalogResponse>({
        queryKey: ['shipping-auspost-service-catalog', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/settings/auspost-service-catalog', token!, currentAccount!.id),
    });
    const bulkLabels = useApiMutation<ShippingBulkLabelResult, number[]>({
        invalidateQueries: [['shipping-orders', currentAccount?.id], ['shipping-hub', currentAccount?.id], ['shipping-labels', currentAccount?.id]],
        mutationFn: (wooOrderIds) => shippingFetch('/orders/bulk-labels', token!, currentAccount!.id, {
            method: 'POST',
            body: JSON.stringify({ wooOrderIds }),
        }),
        onSuccess: (data) => {
            setBulkResult(data);
            if (settingsQuery.data?.carrierAccount?.config?.printDeliveryMethod === 'open_pdf') {
                data.results
                    .filter((result) => result.ok && result.label?.id)
                    .slice(0, 5)
                    .forEach((result) => void openShippingLabelPdf(result.label!.id, token!, currentAccount!.id));
            }
        },
    });
    const saveAddress = useApiMutation<{ draft: ShippingDispatchOrder['draft'] }, DraftFormState>({
        invalidateQueries: [['shipping-orders', currentAccount?.id], ['shipping-hub', currentAccount?.id]],
        mutationFn: async (values) => {
            await shippingFetch(`/orders/${values.wooOrderId}/draft`, token!, currentAccount!.id, {
                method: 'PATCH',
                body: JSON.stringify({
                    correctedAddress: {
                        address1: values.address1,
                        address2: values.address2,
                        suburb: values.suburb,
                        state: values.state,
                        postcode: values.postcode,
                        country: values.country,
                    },
                }),
            });
            return shippingFetch(`/orders/${values.wooOrderId}/validate-address`, token!, currentAccount!.id, { method: 'POST' });
        },
        onSuccess: (data) => {
            setAddressValidationDraft(data.draft);
            if (data.draft.addressValidationStatus === 'valid') setDraftForm(null);
        },
    });
    const requestRates = useApiMutation<unknown, number>({
        mutationFn: (wooOrderId) => shippingFetch(`/orders/${wooOrderId}/rates`, token!, currentAccount!.id, { method: 'POST' }),
    });
    const selectRateService = useApiMutation<{ draft: ShippingDispatchOrder['draft'] }, { wooOrderId: number; serviceCode: string }>({
        invalidateQueries: [['shipping-orders', currentAccount?.id], ['shipping-hub', currentAccount?.id]],
        mutationFn: ({ wooOrderId, serviceCode }) => shippingFetch(`/orders/${wooOrderId}/draft`, token!, currentAccount!.id, {
            method: 'PATCH',
            body: JSON.stringify({ selectedServiceCode: serviceCode }),
        }),
    });
    const selectPackage = useApiMutation<{ draft: ShippingDispatchOrder['draft'] }, { wooOrderId: number; packagePresetId: string }>({
        invalidateQueries: [['shipping-orders', currentAccount?.id], ['shipping-hub', currentAccount?.id]],
        mutationFn: ({ wooOrderId, packagePresetId }) => shippingFetch(`/orders/${wooOrderId}/draft`, token!, currentAccount!.id, {
            method: 'PATCH',
            body: JSON.stringify({ selectedPackagePresetId: packagePresetId || null }),
        }),
    });
    const manualPrint = useApiMutation<unknown, number>({
        invalidateQueries: [['shipping-orders', currentAccount?.id], ['shipping-hub', currentAccount?.id], ['shipping-labels', currentAccount?.id]],
        mutationFn: (wooOrderId) => shippingFetch(`/orders/${wooOrderId}/labels`, token!, currentAccount!.id, {
            method: 'POST',
            body: JSON.stringify({}),
        }),
        onSuccess: async (data, wooOrderId) => {
            const labelId = typeof data === 'object' && data && 'label' in data && typeof (data as { label?: { id?: unknown } }).label?.id === 'string'
                ? (data as { label: { id: string } }).label.id
                : null;
            if (labelId && settingsQuery.data?.carrierAccount?.config?.printDeliveryMethod === 'open_pdf') await openShippingLabelPdf(labelId, token!, currentAccount!.id);
            setManualPrintOrderId(wooOrderId);
        },
    });

    const counts = hubQuery.data?.counts;
    const dispatchOrders = ordersQuery.data?.orders || [];
    const normalizedSearch = queueSearch.trim().toLowerCase();
    const filteredOrders = dispatchOrders
        .filter(({ order, draft }) => {
            const needsAttention = draft.readinessStatus !== 'ready' || draft.addressValidationStatus !== 'valid';
            if (queueFilter === 'ready' && draft.readinessStatus !== 'ready') return false;
            if (queueFilter === 'attention' && !needsAttention) return false;
            if (!normalizedSearch) return true;
            return [
                order.number,
                String(order.wooId),
                order.customerName,
                order.email || '',
                order.shipping.address1 || '',
                order.shipping.suburb || '',
                order.shipping.postcode || '',
            ].some((value) => value.toLowerCase().includes(normalizedSearch));
        })
        .sort((a, b) => {
            if (queueSort === 'newest') return new Date(b.order.dateCreated).getTime() - new Date(a.order.dateCreated).getTime();
            if (queueSort === 'order') return a.order.number.localeCompare(b.order.number, undefined, { numeric: true });
            if (queueSort === 'customer') return a.order.customerName.localeCompare(b.order.customerName);
            return new Date(a.order.dateCreated).getTime() - new Date(b.order.dateCreated).getTime();
        });
    const readyOrderIds = filteredOrders
        .filter(({ draft }) => draft.readinessStatus === 'ready')
        .map(({ order }) => order.wooId);
    const selectedReadyOrders = selectedOrders.filter((wooOrderId) => readyOrderIds.includes(wooOrderId));
    const allReadySelected = readyOrderIds.length > 0 && readyOrderIds.every((wooOrderId) => selectedOrders.includes(wooOrderId));

    const toggleReadySelection = () => {
        setSelectedOrders((current) => allReadySelected ? current.filter((wooOrderId) => !readyOrderIds.includes(wooOrderId)) : Array.from(new Set([...current, ...readyOrderIds])));
        setBulkResult(null);
    };

    const toggleOrder = (wooOrderId: number) => {
        setSelectedOrders((current) => current.includes(wooOrderId) ? current.filter((id) => id !== wooOrderId) : [...current, wooOrderId]);
        setBulkResult(null);
    };

    const openDraftEditor = ({ order, draft }: ShippingDispatchOrder) => {
        const address = draft.correctedAddress && Object.keys(draft.correctedAddress).length > 0 ? draft.correctedAddress : order.shipping;
        setAddressValidationDraft(null);
        setDraftForm({
            wooOrderId: order.wooId,
            address1: address.address1 || '',
            address2: address.address2 || '',
            suburb: address.suburb || '',
            state: address.state || '',
            postcode: address.postcode || '',
            country: address.country || 'AU',
        });
    };

    const updateDraftForm = (key: keyof DraftFormState, value: string) => setDraftForm((current) => current ? { ...current, [key]: value } : current);

    const submitDraft = (event: FormEvent) => {
        event.preventDefault();
        if (draftForm) saveAddress.mutate(draftForm);
    };

    const handleRequestRates = async (wooOrderId: number) => {
        setRateOrderId(wooOrderId);
        try {
            await requestRates.mutateAsync(wooOrderId);
        } catch {
            // The placeholder adapter stores the request snapshot before returning 501.
        } finally {
            await ordersQuery.refetch();
        }
    };

    return (
        <ShippingPageShell
            title="Shipping Hub"
            description="Dispatch workspace for In Dispatch orders, package validation, AusPost label creation, and silent print jobs."
        >
            <div className="grid gap-4 md:grid-cols-4">
                <MetricCard icon={<Truck size={22} />} label="Dispatch Status" value={hubQuery.data?.dispatchStatus || 'In Dispatch'} />
                <MetricCard icon={<PackageCheck size={22} />} label="Shipment Drafts" value={String(counts?.drafts ?? 0)} />
                <MetricCard icon={<CheckCircle2 size={22} />} label="Active Packages" value={String(counts?.packages ?? 0)} />
                <MetricCard icon={<Printer size={22} />} label="Print Stations" value={String(counts?.printStations ?? 0)} />
            </div>

            <ShippingComingSoonCard>
                <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 text-amber-500" size={22} />
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Dispatch queue next</h2>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                            Orders in <code>{hubQuery.data?.dispatchStatus || 'In Dispatch'}</code> are listed as shipment drafts with address validation, package confidence, and partial-success create-and-print actions.
                        </p>
                        {hubQuery.error ? <p className="mt-3 text-sm text-red-600">{hubQuery.error.message}</p> : null}
                    </div>
                </div>
            </ShippingComingSoonCard>

            <ShippingComingSoonCard>
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
                        Dispatch Orders
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                            {dispatchOrders.length}
                        </span>
                    </h2>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={toggleReadySelection}
                            disabled={readyOrderIds.length === 0}
                            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                            {allReadySelected ? 'Clear ready' : 'Select ready'}
                        </button>
                        <button
                            type="button"
                            onClick={() => bulkLabels.mutate(selectedReadyOrders)}
                            disabled={selectedReadyOrders.length === 0 || bulkLabels.isPending}
                            className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {bulkLabels.isPending ? 'Processing...' : `Create & print ${selectedReadyOrders.length || ''}`.trim()}
                        </button>
                    </div>
                </div>
                <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_180px_180px_auto]">
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                        Search queue
                        <input
                            value={queueSearch}
                            onChange={(event) => setQueueSearch(event.target.value)}
                            placeholder="Order, customer, email, suburb, postcode"
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                        />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                        Readiness
                        <select value={queueFilter} onChange={(event) => setQueueFilter(event.target.value as QueueFilter)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
                            <option value="all">All orders</option>
                            <option value="ready">Ready only</option>
                            <option value="attention">Needs attention</option>
                        </select>
                    </label>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                        Sort
                        <select value={queueSort} onChange={(event) => setQueueSort(event.target.value as QueueSort)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
                            <option value="oldest">Oldest first</option>
                            <option value="newest">Newest first</option>
                            <option value="order">Order number</option>
                            <option value="customer">Customer name</option>
                        </select>
                    </label>
                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={() => { setQueueSearch(''); setQueueFilter('all'); setQueueSort('oldest'); }}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                            Clear filters
                        </button>
                    </div>
                </div>
                {ordersQuery.isLoading ? <p className="text-sm text-slate-500">Loading dispatch orders...</p> : null}
                {ordersQuery.error ? <p className="text-sm text-red-600">{ordersQuery.error.message}</p> : null}
                {bulkLabels.error ? <p className="mb-3 text-sm text-red-600">{bulkLabels.error.message}</p> : null}
                {bulkResult ? (
                    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        Bulk result: {bulkResult.succeeded} succeeded, {bulkResult.failed} failed from {bulkResult.requested} selected.
                        {bulkResult.results.some((result) => !result.ok) ? (
                            <ul className="mt-2 space-y-1 text-xs text-red-600 dark:text-red-300">
                                {bulkResult.results.filter((result) => !result.ok).slice(0, 5).map((result) => (
                                    <li key={result.wooOrderId}>#{result.wooOrderId}: {result.error}</li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                ) : null}
                {dispatchOrders.length === 0 && !ordersQuery.isLoading ? <p className="text-sm text-slate-500 dark:text-slate-400">No orders currently match the dispatch status.</p> : null}
                {dispatchOrders.length > 0 && filteredOrders.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No dispatch orders match the current filters.</p> : null}
                <div className="space-y-3">
                    {filteredOrders.map(({ order, draft }) => {
                        const ready = draft.readinessStatus === 'ready';
                        const blockers = draft.readinessErrors?.length ? draft.readinessErrors : draft.addressValidationErrors;
                        const displayAddress = draft.correctedAddress && Object.keys(draft.correctedAddress).length > 0 ? draft.correctedAddress : order.shipping;
                        const selectedPackagePreset = packagesQuery.data?.packages.find((pkg) => pkg.id === draft.selectedPackagePresetId) || null;
                        const addressIsInvalid = draft.addressValidationStatus === 'invalid';
                        return (
                            <div key={order.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="flex gap-3">
                                        <input
                                            type="checkbox"
                                            checked={selectedOrders.includes(order.wooId)}
                                            disabled={!ready}
                                            onChange={() => toggleOrder(order.wooId)}
                                            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
                                            aria-label={`Select order ${order.number}`}
                                        />
                                        <div>
                                            <p className="font-bold text-slate-900 dark:text-white">#{order.number} · {order.customerName}</p>
                                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{order.itemCount} items · {order.currency} {order.total} · {order.email || 'No email'}</p>
                                            <button
                                                type="button"
                                                onClick={() => openDraftEditor({ order, draft })}
                                                className={`mt-2 block text-left text-sm underline-offset-2 hover:underline ${addressIsInvalid ? 'text-red-600 dark:text-red-300' : 'text-slate-600 dark:text-slate-300'}`}
                                            >
                                                {displayAddress.address1}, {displayAddress.suburb} {displayAddress.state} {displayAddress.postcode}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <StatusBadge label={draft.readinessStatus} tone={draft.readinessStatus === 'ready' ? 'green' : 'amber'} />
                                        <StatusBadge label={draft.addressValidationStatus} tone={draft.addressValidationStatus === 'valid' ? 'green' : 'red'} />
                                        <StatusBadge label={draft.packageSelectionConfidence || 'manual_required'} tone="slate" />
                                        <button
                                            type="button"
                                            onClick={() => void handleRequestRates(order.wooId)}
                                            disabled={requestRates.isPending}
                                            className="inline-flex items-center gap-1 rounded-full border border-indigo-200 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
                                        >
                                            <Calculator size={13} /> Rates
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setManualPrintOrderId(order.wooId); manualPrint.mutate(order.wooId); }}
                                            disabled={!ready || manualPrint.isPending}
                                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                        >
                                            <Printer size={13} /> Manual print
                                        </button>
                                    </div>
                                </div>
                                {blockers?.length ? <p className="mt-3 text-sm text-red-600">Needs attention: {blockers.map((error) => error.message || error.field).join(', ')}</p> : null}
                                {manualPrint.error && manualPrintOrderId === order.wooId ? <p className="mt-3 text-sm text-red-600">{manualPrint.error.message}</p> : null}
                                {requestRates.error && rateOrderId === order.wooId ? <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{requestRates.error.message}</p> : null}
                                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(260px,420px)_minmax(260px,360px)]">
                                    <PackageSelector
                                        packages={packagesQuery.data?.packages.filter((pkg) => pkg.isActive) || []}
                                        selectedPackage={selectedPackagePreset}
                                        selectedPackageId={draft.selectedPackagePresetId || ''}
                                        totalWeightGrams={draft.manualWeightGrams || null}
                                        disabled={selectPackage.isPending}
                                        onSelect={(packagePresetId) => selectPackage.mutate({ wooOrderId: order.wooId, packagePresetId })}
                                    />
                                    <RatePreview
                                        response={draft.lastRateResponse && Object.keys(draft.lastRateResponse).length > 0 ? draft.lastRateResponse : null}
                                        serviceCatalog={serviceCatalogQuery.data}
                                        selectedServiceCode={draft.selectedServiceCode || null}
                                        onRequest={() => void handleRequestRates(order.wooId)}
                                        onSelect={(serviceCode) => selectRateService.mutate({ wooOrderId: order.wooId, serviceCode })}
                                        isLoading={requestRates.isPending && rateOrderId === order.wooId}
                                        isSaving={selectRateService.isPending}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </ShippingComingSoonCard>
            {draftForm ? (
                <AddressModal
                    form={draftForm}
                    error={saveAddress.error?.message || null}
                    validationDraft={addressValidationDraft}
                    isSaving={saveAddress.isPending}
                    onChange={updateDraftForm}
                    onClose={() => setDraftForm(null)}
                    onSubmit={submitDraft}
                />
            ) : null}
        </ShippingPageShell>
    );
}

function DraftField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
    return <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}<input type={type} step={type === 'number' ? '0.001' : undefined} min={type === 'number' ? '0' : undefined} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900" /></label>;
}

function AddressModal({
    form,
    error,
    validationDraft,
    isSaving,
    onChange,
    onClose,
    onSubmit,
}: {
    form: DraftFormState;
    error: string | null;
    validationDraft: ShippingDispatchOrder['draft'] | null;
    isSaving: boolean;
    onChange: (key: keyof DraftFormState, value: string) => void;
    onClose: () => void;
    onSubmit: (event: FormEvent) => void;
}) {
    const validationErrors = validationDraft?.addressValidationStatus === 'valid' ? [] : validationDraft?.addressValidationErrors || [];
    const suggestions = validationErrors.flatMap((validationError) => {
        const rawSuggestions = (validationError as { suggestions?: unknown }).suggestions;
        return Array.isArray(rawSuggestions) ? rawSuggestions.map((suggestion) => String(suggestion)) : [];
    });
    const applySuggestion = (suggestion: string) => {
        const match = suggestion.match(/^(.+?),?\s+([A-Z]{2,3})\s+(\d{4})$/i);
        if (!match) return;
        onChange('suburb', match[1].trim());
        onChange('state', match[2].toUpperCase());
        onChange('postcode', match[3]);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <form onSubmit={onSubmit} className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Edit delivery address</h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Saving validates the address before closing. Invalid suburbs, states, or postcodes will stay open with suggestions.</p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Close address editor"><X size={18} /></button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <DraftField label="Address 1" value={form.address1} onChange={(value) => onChange('address1', value)} />
                    <DraftField label="Address 2" value={form.address2} onChange={(value) => onChange('address2', value)} />
                    <DraftField label="Suburb" value={form.suburb} onChange={(value) => onChange('suburb', value)} />
                    <DraftField label="State" value={form.state} onChange={(value) => onChange('state', value)} />
                    <DraftField label="Postcode" value={form.postcode} onChange={(value) => onChange('postcode', value)} />
                    <DraftField label="Country" value={form.country} onChange={(value) => onChange('country', value)} />
                </div>
                {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
                {validationErrors.length > 0 ? (
                    <div className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                        <p className="font-semibold">Address could not be validated.</p>
                        {validationErrors.map((validationError, index) => <p key={`${validationError.field}-${index}`} className="mt-1">{validationError.message}</p>)}
                        {suggestions.length > 0 ? (
                            <div className="mt-3">
                                <p className="text-xs font-semibold uppercase">Closest matches</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {suggestions.map((suggestion) => (
                                        <button key={suggestion} type="button" onClick={() => applySuggestion(suggestion)} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 dark:bg-slate-900 dark:text-red-200 dark:hover:bg-red-500/20">
                                            {suggestion}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}
                <div className="mt-5 flex flex-wrap gap-2">
                    <button type="submit" disabled={isSaving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><Save size={16} /> {isSaving ? 'Validating...' : 'Save address'}</button>
                    <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
                </div>
            </form>
        </div>
    );
}

function PackageSelector({
    packages,
    selectedPackage,
    selectedPackageId,
    totalWeightGrams,
    disabled,
    onSelect,
}: {
    packages: ShippingPackagePreset[];
    selectedPackage: ShippingPackagePreset | null;
    selectedPackageId: string;
    totalWeightGrams: number | null;
    disabled: boolean;
    onSelect: (packagePresetId: string) => void;
}) {
    return (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-slate-200 p-2 dark:border-slate-700">
                <select value={selectedPackageId} onChange={(event) => onSelect(event.target.value)} disabled={disabled} className="min-w-0 rounded border-0 bg-transparent p-0 text-sm font-semibold text-slate-900 focus:ring-0 disabled:opacity-60 dark:text-white">
                    <option value="">Select package</option>
                    {packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}</option>)}
                </select>
                <PackageCheck size={15} className="text-slate-500" />
                <p className="text-xs text-slate-600 dark:text-slate-300">
                    {selectedPackage ? `${mmToCm(selectedPackage.outerLengthMm)} x ${mmToCm(selectedPackage.outerWidthMm)} x ${mmToCm(selectedPackage.outerHeightMm)} cm` : 'No configured package selected'}
                </p>
                <p className="text-right text-xs text-slate-600 dark:text-slate-300">{selectedPackage ? `${gramsToKg(selectedPackage.packagingWeightGrams)} kg` : ''}</p>
            </div>
            <div className="flex items-center justify-between bg-slate-50 px-2 py-1.5 text-xs text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                <span>Total Weight: {totalWeightGrams ? `${gramsToKg(totalWeightGrams)}kg` : 'Unknown'}</span>
                <span className="text-lg leading-none text-slate-900 dark:text-white">+</span>
            </div>
        </div>
    );
}

function RatePreview({
    response,
    serviceCatalog,
    selectedServiceCode,
    onRequest,
    onSelect,
    isLoading,
    isSaving,
}: {
    response: Record<string, unknown> | null;
    serviceCatalog: AusPostServiceCatalogResponse | undefined;
    selectedServiceCode: string | null;
    onRequest: () => void;
    onSelect: (serviceCode: string) => void;
    isLoading: boolean;
    isSaving: boolean;
}) {
    const rates = Array.isArray(response?.rates) ? response.rates as Array<Record<string, unknown>> : [];
    const warnings = Array.isArray(response?.warnings) ? response.warnings.map((warning) => String(warning)) : [];
    const errors = Array.isArray(response?.errors) ? response.errors.map((error) => String(error)) : [];
    if (!response) {
        return (
            <div className="h-full rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold underline text-indigo-700 dark:text-indigo-300">Available Rates</p>
                    <button type="button" onClick={onRequest} disabled={isLoading} className="rounded-full border border-indigo-200 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
                        {isLoading ? 'Loading...' : 'Get rates'}
                    </button>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Request rates to choose the AusPost service for this order.</p>
            </div>
        );
    }
    if (rates.length === 0) {
        return (
            <div className="h-full rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold underline">Available Rates</p>
                    <button type="button" onClick={onRequest} disabled={isLoading} className="rounded-full border border-amber-200 px-2 py-1 text-[11px] font-semibold hover:bg-amber-100 disabled:opacity-50 dark:border-amber-500/40 dark:hover:bg-amber-500/10">
                        {isLoading ? 'Loading...' : 'Refresh'}
                    </button>
                </div>
                <p>{friendlyRateMessage(response)}</p>
                <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-semibold">Raw diagnostics</summary>
                    <pre className="mt-2 overflow-auto rounded bg-amber-100/80 p-2 text-[11px] leading-relaxed text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{JSON.stringify(response, null, 2)}</pre>
                </details>
            </div>
        );
    }
    return (
        <div className="h-full rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold underline text-indigo-700 dark:text-indigo-300">Available Rates</p>
                <button type="button" onClick={onRequest} disabled={isLoading} className="rounded-full border border-indigo-200 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
                    {isLoading ? 'Loading...' : 'Refresh'}
                </button>
            </div>
            {warnings.length > 0 ? <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Carrier warning: {warnings.join(' | ')}</p> : null}
            {errors.length > 0 ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">Carrier error: {errors.join(' | ')}</p> : null}
            <div className="mt-2 space-y-1">
                {rates.map((rate, index) => {
                    const serviceCode = String(rate.productId || rate.product_id || rate.serviceCode || rate.service_code || '');
                    const serviceFallback = String(rate.serviceName || rate.service_name || rate.productType || rate.product_type || '');
                    const serviceName = serviceCodeNaturalLabel(serviceCatalog, serviceCode, serviceFallback);
                    const amount = String(rate.totalCost || rate.amount || rate.price || '-');
                    const formattedAmount = amount === '-' || amount.startsWith('$') ? amount : `$${amount}`;
                    return (
                        <div key={`${serviceCode || serviceName}-${index}`} className={`grid grid-cols-[1fr_auto] items-center gap-2 rounded px-1 py-1 text-xs ${selectedServiceCode === serviceCode ? 'bg-indigo-50 dark:bg-indigo-500/10' : ''}`}>
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white">AP</span>
                                <div className="min-w-0">
                                    <p className="truncate font-bold text-slate-900 dark:text-white">{serviceName}</p>
                                    {serviceFallback && serviceFallback !== serviceName ? <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{serviceFallback}</p> : null}
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="font-semibold text-slate-900 dark:text-white">{formattedAmount}</p>
                                {serviceCode ? (
                            <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => onSelect(serviceCode)}
                                className="text-[11px] font-semibold text-indigo-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-indigo-300"
                            >
                                        {selectedServiceCode === serviceCode ? 'Selected' : 'Select'}
                            </button>
                        ) : null}
                            </div>
                        </div>
                    );
                })}
            </div>
            <details className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                <summary className="cursor-pointer font-semibold">Raw diagnostics</summary>
                <pre className="mt-2 overflow-auto rounded bg-slate-100 p-2 text-[11px] leading-relaxed text-slate-700 dark:bg-slate-900 dark:text-slate-200">{JSON.stringify(response, null, 2)}</pre>
            </details>
        </div>
    );
}

function friendlyRateMessage(response: Record<string, unknown>) {
    const message = typeof response.message === 'string' ? response.message : '';
    if (message.toLowerCase().includes('service code')) return 'Select an AusPost service before creating a label, or configure a default service in Shipping Settings.';
    if (message.toLowerCase().includes('credentials')) return 'AusPost credentials are missing or incomplete. Update Shipping Settings and test the connection.';
    return message || 'No rates were returned by AusPost for this draft. Check package dimensions, weight, and destination address.';
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <ShippingComingSoonCard>
            <div className="flex items-center gap-3">
                <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">{icon}</div>
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{value}</p>
                </div>
            </div>
        </ShippingComingSoonCard>
    );
}

function StatusBadge({ label, tone }: { label: string; tone: 'green' | 'amber' | 'red' | 'slate' }) {
    const tones = {
        green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
        amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
        red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
        slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    };
    return <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${tones[tone]}`}>{label.replace(/_/g, ' ')}</span>;
}
