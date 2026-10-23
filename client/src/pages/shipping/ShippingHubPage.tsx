import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Modal } from '../../components/ui/Modal';
import { usePermissions } from '../../hooks/usePermissions';
import { cmToMm, kgToGrams, mmToCm, gramsToKg } from './shippingApi';
import { catalogSchema, date, decodeCatalog, identity, ShippingBoundary, ShippingReadState, text, useDraftUnload, useReviewedShippingWrite, useShippingRead, type ShippingScope } from './shippingWorkspace';
import { ShippingPageShell } from './ShippingPageShell';
import { Package, RefreshCw, Search, ExternalLink, MapPin } from 'lucide-react';
import { workspaceStyles as ui } from '../../components/ui/workspaceStyles';
import { DataNote } from '../../components/ui/DataNote';
const draftSchema = z.object({ id: identity, accountId: identity, wooOrderId: z.number().int().positive().safe(), updatedAt: date, readinessStatus: text, addressValidationStatus: text, correctedAddress: z.record(z.string(), z.unknown()).nullish(), selectedPackagePresetId: identity.nullish(), manualOuterLengthMm: z.number().int().positive().nullish(), manualOuterWidthMm: z.number().int().positive().nullish(), manualOuterHeightMm: z.number().int().positive().nullish(), manualWeightGrams: z.number().int().positive().nullish(), selectedServiceCode: z.string().max(80).nullish(), lastRateResponse: z.record(z.string(), z.unknown()).nullish() });
const orderSchema = z.object({ id: identity, accountId: identity, wooId: z.number().int().positive().safe(), updatedAt: date, number: text, status: text.nullable(), total: z.union([text, z.number().finite()]).nullable(), currency: z.string().max(10).nullable(), dateCreated: date });
const schema = z.object({ accountId: identity, dispatchStatus: text, basis: text, partial: z.boolean(), policy: z.object({ updatedAt: date, config: z.record(z.string(), z.unknown()).nullish() }).nullable(), orders: z.array(z.object({ order: orderSchema, draft: draftSchema.nullable() })).max(100) });
function decode(value: unknown) { return schema.parse(value); }
type Row = z.infer<typeof schema>['orders'][number];
export function ShippingHubPage() { return <ShippingBoundary>{scope => <Dispatch scope={scope} />}</ShippingBoundary>; }
function Dispatch({ scope }: { scope: ShippingScope }) {
    const read = useShippingRead('/workspace/dispatch', scope, decode), catalog = useShippingRead('/workspace/catalog', scope, decodeCatalog), write = useReviewedShippingWrite(scope), { hasPermission } = usePermissions();
    const [selected, setSelected] = useState<string | null>(null), [search, setSearch] = useState('');
    const canLeave = useRef<() => boolean>(() => true);
    if (read.loading || read.error || !read.data || read.data.orders.some(row => row.order.accountId !== scope.accountId || row.draft && (row.draft.accountId !== scope.accountId || row.draft.wooOrderId !== row.order.wooId))) return <ShippingReadState loading={read.loading} retry={read.retry} />;
    const snapshot = read.data, row = snapshot.orders.find(value => value.order.id === selected);
    const run = async (row: Row, action: 'prepare' | 'draft' | 'validate' | 'rates' | 'create', data: Record<string, unknown> = {}) => {
        if (write.isPending() || write.blocked || !hasPermission('create_shipping_labels') || action === 'create' && !hasPermission('print_shipping_labels')) return;
        if (!window.confirm(action === 'create' ? `Create a billable carrier label for order ${row.order.number}, using the reviewed draft and current configured output? This may physically print and may complete the order under policy. Closing/timeout does not undo it. Never retry an uncertain create.` : `${action === 'prepare' ? 'Prepare a local pending draft (no carrier request)' : action === 'draft' ? 'Save this reviewed local draft; validation and previous quotes will be invalidated' : action === 'validate' ? 'Validate the saved delivery address; this may contact the carrier' : 'Request a rate observation for the saved draft; this does not purchase a label'}?`)) return;
        const pkg = catalog.data?.packages.find(value => value.id === row.draft?.selectedPackagePresetId);
        const result = await write.run('/workspace/action', { action, resourceId: action === 'prepare' ? row.order.id : row.draft!.id, version: action === 'prepare' ? row.order.updatedAt : row.draft!.updatedAt, orderVersion: row.order.updatedAt, ...(snapshot.policy ? { policyVersion: snapshot.policy.updatedAt } : {}), ...(pkg ? { packageVersion: pkg.updatedAt } : {}), data });
        if (result.ok && write.isActive()) read.retry();
    };
    const leave = (work: () => void) => { if (!write.isPending() && (!write.blocked || window.confirm('Leave this unconfirmed action for manual reconciliation? Its durable operation is retained and no server/provider work is rolled back.')) && canLeave.current()) work(); };
    const filtered = snapshot.orders.filter(value => `${value.order.number} ${value.order.wooId}`.toLowerCase().includes(search.toLowerCase()));
    return <ShippingPageShell title="Shipping Hub" description="Review one scoped order/draft at a time. Carrier actions are deliberate and receipt-bound; no bulk create-and-print or automatic PDF opening."><div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><span className={ui.badge}>{snapshot.dispatchStatus}</span><span className={ui.muted}>{snapshot.orders.length} orders in this window</span></div><button className={ui.secondary} type="button" disabled={write.busy || write.blocked} onClick={() => leave(read.retry)}><RefreshCw size={14} />Refresh dispatch read</button></div>
        <DataNote title="Dispatch coverage">Observed dispatch status: {snapshot.dispatchStatus} ({snapshot.basis}). Oldest up to 100 locally synced orders{snapshot.partial ? '; partial window' : '; carrier/source completeness unknown'}. No account-wide counts are inferred.</DataNote>
        {write.error && <p role="alert" className={ui.alert}>{write.error}</p>}
        <label className={`${ui.label} max-w-md`}><span className="flex items-center gap-2"><Search size={14} />Filter this order window</span><input className={ui.input} placeholder="Search order number…" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="grid gap-4 xl:grid-cols-2">{filtered.map(value => <section className={`${ui.card} space-y-4`} key={value.order.id}>
            <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="flex min-w-0 items-center gap-2 font-semibold"><Package size={18} className="shrink-0 text-indigo-500" /><span className="break-all">Order {value.order.number}</span></h2><span className={`${ui.badge} capitalize`}>{value.order.status ?? 'unknown status'}</span></div>
            <p className="text-sm font-medium">{value.order.currency && /^[A-Z]{3}$/.test(value.order.currency) && value.order.total !== null && /^\d+(?:\.\d{1,2})?$/.test(String(value.order.total)) ? `${value.order.currency} ${value.order.total} recorded gross total` : 'Monetary basis unavailable'}</p>
            <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900/50"><p><span className={ui.muted}>Draft: </span>{value.draft ? `${value.draft.readinessStatus}; address ${value.draft.addressValidationStatus}` : 'No local draft observed'}</p></div>
            <div className="flex flex-wrap items-center justify-between gap-3"><Link className={`${ui.link} inline-flex items-center gap-1`} to={`/orders/${value.order.wooId}`}>Review source order<ExternalLink size={12} /></Link>{value.draft ? <button className={ui.primary} type="button" disabled={write.busy || write.blocked} onClick={() => leave(() => setSelected(value.order.id))}>Review draft for order {value.order.number}</button> : hasPermission('create_shipping_labels') && <button className={ui.secondary} type="button" disabled={write.busy || write.blocked} onClick={() => void run(value, 'prepare')}>Prepare local draft for {value.order.number}</button>}</div>
        </section>)}</div>
        {!snapshot.orders.length ? <p className={ui.empty}>No local orders in this acknowledged dispatch window.</p> : !filtered.length && <p className={ui.empty}>No orders match this filter.</p>}
        {row?.draft && <DraftReview key={`${row.order.id}:${row.draft.updatedAt}`} scope={scope} row={row} policy={snapshot.policy} catalog={!catalog.error && catalog.data?.accountId === scope.accountId ? catalog.data : null} busy={write.busy} blocked={write.blocked} canLeave={canLeave} run={(action, data) => run(row, action, data)} close={() => leave(() => setSelected(null))} />}
    </div></ShippingPageShell>;
}
function DraftReview({ row, policy, catalog, busy, blocked: unconfirmed, canLeave: canLeaveRef, run, close }: { scope: ShippingScope; row: Row; policy: z.infer<typeof schema>['policy']; catalog: z.infer<typeof catalogSchema> | null; busy: boolean; blocked: boolean; canLeave: React.MutableRefObject<() => boolean>; run: (action: 'draft' | 'validate' | 'rates' | 'create', data?: Record<string, unknown>) => Promise<void>; close: () => void }) {
    // Pending work blocks dismissal; an unconfirmed outcome separately locks edits
    // but may be deliberately dismissed with the parent's reconciliation warning.
    const blocked = busy && unconfirmed;
    const draft = row.draft!, { hasPermission } = usePermissions();
    const addressKeys = ['address1', 'address2', 'suburb', 'state', 'postcode', 'country'];
    const [address, setAddress] = useState<Record<string, string>>(() => Object.fromEntries(addressKeys.map(key => [key, typeof draft.correctedAddress?.[key] === 'string' ? String(draft.correctedAddress[key]) : ''])));
    const [pkg, setPkg] = useState(draft.selectedPackagePresetId ?? ''), [dims, setDims] = useState(() => [draft.manualOuterLengthMm, draft.manualOuterWidthMm, draft.manualOuterHeightMm].map(value => String(mmToCm(value)))), [weight, setWeight] = useState(() => String(gramsToKg(draft.manualWeightGrams))), [service, setService] = useState(draft.selectedServiceCode ?? ''), [error, setError] = useState('');
    const [baseline] = useState(() => JSON.stringify([address, pkg, dims, weight, service])), dirty = JSON.stringify([address, pkg, dims, weight, service]) !== baseline;
    useDraftUnload(dirty || busy || unconfirmed);
    useLayoutEffect(() => { canLeaveRef.current = () => !dirty || window.confirm('Discard this unsaved draft? An unconfirmed server action is not rolled back.'); return () => { canLeaveRef.current = () => true; }; }, [canLeaveRef, dirty]);
    const editable = hasPermission('create_shipping_labels') && !busy && !unconfirmed;
    const save = async () => {
        try {
            const correctedAddress = z.object({ address1: z.string().trim().min(1).max(200), address2: z.string().max(200), suburb: z.string().trim().min(1).max(100), state: z.string().trim().min(1).max(100), postcode: z.string().trim().min(1).max(20), country: z.string().regex(/^[A-Z]{2}$/) }).parse(address);
            const selectedServiceCode = z.string().trim().min(1).max(80).parse(service);
            const dimensions = pkg ? [null, null, null] : dims.map(cmToMm), grams = pkg ? null : kgToGrams(weight);
            if (!pkg && ![...dimensions, grams].every(value => typeof value === 'number' && value > 0 && value <= 10000000)) throw new Error('Dimensions unavailable');
            if (pkg && !catalog?.packages.some(value => value.id === pkg && value.isActive)) throw new Error('Package unavailable');
            await run('draft', { correctedAddress, selectedServiceCode, selectedPackagePresetId: pkg || null, manualOuterLengthMm: dimensions[0], manualOuterWidthMm: dimensions[1], manualOuterHeightMm: dimensions[2], manualWeightGrams: grams });
        } catch { setError('Review complete address/country, service code and either an active scoped package or exactly three positive cm dimensions plus kg weight. No unsupported precision or inferred item weight.'); }
    };
    const delivery = policy?.config?.printDeliveryMethod, fulfillment = policy?.config?.wooFulfillmentBehavior;
    const outputKnown = delivery === 'remote_print' || delivery === 'open_pdf';
    const canCreate = editable && !dirty && hasPermission('print_shipping_labels') && outputKnown && draft.readinessStatus === 'ready' && draft.addressValidationStatus === 'valid' && (!draft.selectedPackagePresetId || !!catalog?.packages.some(value => value.id === draft.selectedPackagePresetId && value.isActive));
    const addressLabels: Record<string, string> = { address1: 'Address line 1', address2: 'Address line 2', suburb: 'Suburb', state: 'State', postcode: 'Postcode', country: 'Country (2-letter code)' };
    return <Modal isOpen onClose={busy || blocked ? undefined : close} title={`Review order ${row.order.number} draft`} maxWidth="max-w-3xl"><div className="space-y-5 text-slate-900 dark:text-slate-100">
        <p className={ui.notice}>Output: {outputKnown ? String(delivery) : 'unknown; creation unavailable'}. Fulfillment policy: {typeof fulfillment === 'string' && ['keep_in_dispatch', 'label_created', 'print_success'].includes(fulfillment) ? fulfillment : fulfillment == null ? 'server default keep in dispatch' : 'unknown'}.</p>
        <p className={ui.muted}>Saved address/packing/service only. A saved edit invalidates validation and prior quotes. Validate separately; no address is silently defaulted to Australia.</p>
        {error && <p role="alert" className={ui.alert}>{error}</p>}
        <fieldset disabled={!editable} className="space-y-5"><section className="space-y-3"><h3 className={`${ui.title} flex items-center gap-2`}><MapPin size={16} className="text-indigo-500" />Delivery address</h3><div className="grid gap-3 sm:grid-cols-2">{addressKeys.map(key => <label className={ui.label} key={key}>{addressLabels[key]}<input aria-label={key} className={ui.input} maxLength={key === 'country' ? 2 : 200} value={address[key]} onChange={event => setAddress({ ...address, [key]: event.target.value })} /></label>)}</div></section>
            <section className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-700"><h3 className={`${ui.title} flex items-center gap-2`}><Package size={16} className="text-indigo-500" />Package and service</h3><label className={ui.label}>Recorded service code (verify against carrier service configuration)<input className={ui.input} maxLength={80} value={service} onChange={event => setService(event.target.value)} /></label><label className={ui.label}>Scoped package preset<select className={ui.input} value={pkg} onChange={event => setPkg(event.target.value)}><option value="">Manual measured package</option>{catalog?.packages.filter(value => value.isActive).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>{!catalog && <p className={ui.notice}>Package catalog unavailable; no package name or weight is inferred.</p>}{!pkg && <><div className="grid gap-3 sm:grid-cols-3">{['Length', 'Width', 'Height'].map((label, index) => <label className={ui.label} key={label}>{label} (cm)<input className={ui.input} value={dims[index]} maxLength={20} onChange={event => setDims(dims.map((value, i) => i === index ? event.target.value : value))} /></label>)}</div><label className={ui.label}>Measured packed weight (kg)<input className={ui.input} value={weight} maxLength={20} onChange={event => setWeight(event.target.value)} /></label></>}</section>
        </fieldset>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-700"><button className={ui.primary} type="button" disabled={!editable || !dirty} onClick={() => void save()}>Save reviewed draft only</button><button className={ui.secondary} type="button" disabled={!editable || dirty || !policy} onClick={() => void run('validate')}>Validate saved address</button><button className={ui.secondary} type="button" disabled={!editable || dirty || !policy} onClick={() => void run('rates')}>Request saved-draft rate observation</button><button className={ui.danger} type="button" disabled={!canCreate} onClick={() => void run('create')}>Review create label and configured output</button><button className={ui.secondary} type="button" disabled={busy || blocked} onClick={close}>Close draft review</button></div>
        <DataNote title="Rates and carrier actions">Rate prices are not asserted from unchecked legacy carrier snapshots; no currency is invented. Rates do not select a service or create a label. Failed/partial actions retain their occurrence for reconciliation. No bulk action or PDF/print popup is triggered by a successful response.</DataNote>
    </div></Modal>;
}
