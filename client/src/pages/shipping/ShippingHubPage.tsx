import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, Edit3, PackageCheck, Printer, Save, Truck } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import { serviceCodeLabelFormatter, serviceCodeOptionsFromCatalog } from './auspostServiceCatalog';
import { ShippingComingSoonCard, ShippingPageShell } from './ShippingPageShell';
import { cmToMm, gramsToKg, kgToGrams, mmToCm, openShippingLabelPdf, shippingFetch, type AusPostServiceCatalogResponse, type ShippingBulkLabelResult, type ShippingDispatchOrder, type ShippingHubSummary, type ShippingPackagePreset, type ShippingPrintStation, type ShippingSettingsResponse } from './shippingApi';

type QueueFilter = 'all' | 'ready' | 'attention';
type QueueSort = 'oldest' | 'newest' | 'order' | 'customer';

interface DraftFormState {
    wooOrderId: number;
    selectedPackagePresetId: string;
    manualOuterLengthCm: string;
    manualOuterWidthCm: string;
    manualOuterHeightCm: string;
    manualWeightKg: string;
    selectedServiceCode: string;
    selectedPrintStationId: string;
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
    const [rateOrderId, setRateOrderId] = useState<number | null>(null);
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
    const printStationsQuery = useApiQuery<{ printStations: ShippingPrintStation[] }>({
        queryKey: ['shipping-print-stations', currentAccount?.id],
        enabled: canFetch,
        queryFn: () => shippingFetch('/print-stations', token!, currentAccount!.id),
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
    const saveDraft = useApiMutation<{ draft: ShippingDispatchOrder['draft'] }, DraftFormState>({
        invalidateQueries: [['shipping-orders', currentAccount?.id], ['shipping-hub', currentAccount?.id]],
        mutationFn: (values) => shippingFetch(`/orders/${values.wooOrderId}/draft`, token!, currentAccount!.id, {
            method: 'PATCH',
            body: JSON.stringify({
                selectedPackagePresetId: values.selectedPackagePresetId || null,
                manualOuterLengthMm: cmToMm(values.manualOuterLengthCm),
                manualOuterWidthMm: cmToMm(values.manualOuterWidthCm),
                manualOuterHeightMm: cmToMm(values.manualOuterHeightCm),
                manualWeightGrams: kgToGrams(values.manualWeightKg),
                selectedServiceCode: values.selectedServiceCode || null,
                selectedPrintStationId: values.selectedPrintStationId || null,
                correctedAddress: {
                    address1: values.address1,
                    address2: values.address2,
                    suburb: values.suburb,
                    state: values.state,
                    postcode: values.postcode,
                    country: values.country,
                },
            }),
        }),
        onSuccess: () => setDraftForm(null),
    });
    const validateAddress = useApiMutation<{ draft: ShippingDispatchOrder['draft'] }, number>({
        invalidateQueries: [['shipping-orders', currentAccount?.id], ['shipping-hub', currentAccount?.id]],
        mutationFn: (wooOrderId) => shippingFetch(`/orders/${wooOrderId}/validate-address`, token!, currentAccount!.id, { method: 'POST' }),
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
    const draftServiceCodeOptions = serviceCodeOptionsFromCatalog(serviceCatalogQuery.data, [
        draftForm?.selectedServiceCode || '',
    ]);
    const formatServiceCodeOption = serviceCodeLabelFormatter(serviceCatalogQuery.data);

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
        setDraftForm({
            wooOrderId: order.wooId,
            selectedPackagePresetId: draft.selectedPackagePresetId || '',
            manualOuterLengthCm: String(mmToCm(draft.manualOuterLengthMm)),
            manualOuterWidthCm: String(mmToCm(draft.manualOuterWidthMm)),
            manualOuterHeightCm: String(mmToCm(draft.manualOuterHeightMm)),
            manualWeightKg: String(gramsToKg(draft.manualWeightGrams)),
            selectedServiceCode: draft.selectedServiceCode || '',
            selectedPrintStationId: draft.selectedPrintStationId || '',
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
        if (draftForm) saveDraft.mutate(draftForm);
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
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Dispatch Orders</h2>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">{filteredOrders.length} of {dispatchOrders.length} orders</span>
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
                                            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{order.shipping.address1}, {order.shipping.suburb} {order.shipping.state} {order.shipping.postcode}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <StatusBadge label={draft.readinessStatus} tone={draft.readinessStatus === 'ready' ? 'green' : 'amber'} />
                                        <StatusBadge label={draft.addressValidationStatus} tone={draft.addressValidationStatus === 'valid' ? 'green' : 'red'} />
                                        <StatusBadge label={draft.packageSelectionConfidence || 'manual_required'} tone="slate" />
                                        <button
                                            type="button"
                                            onClick={() => openDraftEditor({ order, draft })}
                                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                        >
                                            <Edit3 size={13} /> Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => validateAddress.mutate(order.wooId)}
                                            disabled={validateAddress.isPending}
                                            className="rounded-full border border-indigo-200 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
                                        >
                                            Validate address
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void handleRequestRates(order.wooId)}
                                            disabled={requestRates.isPending}
                                            className="inline-flex items-center gap-1 rounded-full border border-indigo-200 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
                                        >
                                            <Calculator size={13} /> Rates
                                        </button>
                                    </div>
                                </div>
                                {blockers?.length ? <p className="mt-3 text-sm text-red-600">Needs attention: {blockers.map((error) => error.message || error.field).join(', ')}</p> : null}
                                {requestRates.error && rateOrderId === order.wooId ? <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{requestRates.error.message}</p> : null}
                                {draft.lastRateResponse && Object.keys(draft.lastRateResponse).length > 0 ? (
                                    <RatePreview
                                        response={draft.lastRateResponse}
                                        selectedServiceCode={draft.selectedServiceCode || null}
                                        onSelect={(serviceCode) => selectRateService.mutate({ wooOrderId: order.wooId, serviceCode })}
                                        isSaving={selectRateService.isPending}
                                    />
                                ) : null}
                                {draftForm?.wooOrderId === order.wooId ? (
                                    <form onSubmit={submitDraft} className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/5">
                                        <div className="grid gap-3 md:grid-cols-3">
                                            <DraftField label="Address 1" value={draftForm.address1} onChange={(value) => updateDraftForm('address1', value)} />
                                            <DraftField label="Address 2" value={draftForm.address2} onChange={(value) => updateDraftForm('address2', value)} />
                                            <DraftField label="Suburb" value={draftForm.suburb} onChange={(value) => updateDraftForm('suburb', value)} />
                                            <DraftField label="State" value={draftForm.state} onChange={(value) => updateDraftForm('state', value)} />
                                            <DraftField label="Postcode" value={draftForm.postcode} onChange={(value) => updateDraftForm('postcode', value)} />
                                            <DraftField label="Country" value={draftForm.country} onChange={(value) => updateDraftForm('country', value)} />
                                        </div>
                                        <div className="mt-4 grid gap-3 md:grid-cols-4">
                                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Package preset<select value={draftForm.selectedPackagePresetId} onChange={(event) => updateDraftForm('selectedPackagePresetId', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"><option value="">Manual dimensions</option>{packagesQuery.data?.packages.filter((pkg) => pkg.isActive).map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}</option>)}</select></label>
                                            <DraftField label="Outer L (cm)" type="number" value={draftForm.manualOuterLengthCm} onChange={(value) => updateDraftForm('manualOuterLengthCm', value)} />
                                            <DraftField label="Outer W (cm)" type="number" value={draftForm.manualOuterWidthCm} onChange={(value) => updateDraftForm('manualOuterWidthCm', value)} />
                                            <DraftField label="Outer H (cm)" type="number" value={draftForm.manualOuterHeightCm} onChange={(value) => updateDraftForm('manualOuterHeightCm', value)} />
                                            <DraftField label="Weight (kg)" type="number" value={draftForm.manualWeightKg} onChange={(value) => updateDraftForm('manualWeightKg', value)} />
                                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Service code<select value={draftForm.selectedServiceCode} onChange={(event) => updateDraftForm('selectedServiceCode', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"><option value="">Use default service</option>{draftServiceCodeOptions.map((option) => <option key={option} value={option}>{formatServiceCodeOption(option)}</option>)}</select></label>
                                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Print station<select value={draftForm.selectedPrintStationId} onChange={(event) => updateDraftForm('selectedPrintStationId', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"><option value="">Account default</option>{printStationsQuery.data?.printStations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label>
                                        </div>
                                        {saveDraft.error ? <p className="mt-3 text-sm text-red-600">{saveDraft.error.message}</p> : null}
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            <button type="submit" disabled={saveDraft.isPending} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><Save size={16} /> Save draft</button>
                                            <button type="button" onClick={() => setDraftForm(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
                                        </div>
                                    </form>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            </ShippingComingSoonCard>
        </ShippingPageShell>
    );
}

function DraftField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
    return <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}<input type={type} step={type === 'number' ? '0.001' : undefined} min={type === 'number' ? '0' : undefined} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900" /></label>;
}

function RatePreview({
    response,
    selectedServiceCode,
    onSelect,
    isSaving,
}: {
    response: Record<string, unknown>;
    selectedServiceCode: string | null;
    onSelect: (serviceCode: string) => void;
    isSaving: boolean;
}) {
    const rates = Array.isArray(response.rates) ? response.rates as Array<Record<string, unknown>> : [];
    const warnings = Array.isArray(response.warnings) ? response.warnings.map((warning) => String(warning)) : [];
    const errors = Array.isArray(response.errors) ? response.errors.map((error) => String(error)) : [];
    if (rates.length === 0) {
        return (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                <p>{friendlyRateMessage(response)}</p>
                <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-semibold">Raw diagnostics</summary>
                    <pre className="mt-2 overflow-auto rounded bg-amber-100/80 p-2 text-[11px] leading-relaxed text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{JSON.stringify(response, null, 2)}</pre>
                </details>
            </div>
        );
    }
    return (
        <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Rate options</p>
            {warnings.length > 0 ? <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Carrier warning: {warnings.join(' | ')}</p> : null}
            {errors.length > 0 ? <p className="mt-2 text-sm text-red-700 dark:text-red-300">Carrier error: {errors.join(' | ')}</p> : null}
            <div className="mt-2 grid gap-2 md:grid-cols-3">
                {rates.map((rate, index) => (
                    <div key={`${String(rate.productId || rate.serviceCode || rate.serviceName || 'service')}-${index}`} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">
                        <p className="font-semibold text-slate-900 dark:text-white">{String(rate.productId || rate.serviceName || rate.serviceCode || 'Service')}</p>
                        <p className="text-slate-600 dark:text-slate-300">AUD {String(rate.totalCost || rate.amount || '-')}</p>
                        {String(rate.productId || '') ? (
                            <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => onSelect(String(rate.productId))}
                                className="mt-2 rounded-full border border-indigo-200 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
                            >
                                {selectedServiceCode === String(rate.productId) ? 'Selected' : 'Select service'}
                            </button>
                        ) : null}
                    </div>
                ))}
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
