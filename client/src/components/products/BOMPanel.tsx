/** Account/product/variation-scoped BOM editor. Failed reads never become empty BOMs. */
import { useState, useImperativeHandle, forwardRef, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { isRecord } from '../../utils/responseValidation';
import { BOMCostSummary, BOMSearchDropdown, BOMItemsTable, type BOMItem } from './bom';
import type { BOMSearchResultProduct } from './bom/BOMSearchDropdown';
import { bomNumber, validBOMValues, validStock } from './bom/bomValues';
import { Layers } from 'lucide-react';
import { workspaceStyles as ui } from '../ui/workspaceStyles';

interface BOMPanelProps {
    productId: string; variants?: { id: number; sku?: string }[]; fixedVariationId?: number;
    onSaveComplete?: () => void; onCOGSUpdate?: (cogs: number | null, hasItems: boolean) => void; onSyncComplete?: (newStock: number) => void;
}
export interface BOMPanelRef { save: () => Promise<boolean> }
type ScopeProps = BOMPanelProps & { token: string; accountId: string; currency?: string; scope: number };
function decodeBOM(value: unknown): BOMItem[] {
    if (!isRecord(value) || !Array.isArray(value.items)) throw new Error('Invalid BOM');
    return value.items.map(item => {
        if (!isRecord(item)) throw new Error('Invalid BOM item');
        const quantity = bomNumber(item.quantity); const wasteFactor = bomNumber(item.wasteFactor);
        if (!validBOMValues({ quantity, wasteFactor })) throw new Error('Invalid BOM quantities');
        for (const field of ['id', 'childProductId', 'internalProductId', 'supplierItemId']) if (item[field] != null && typeof item[field] !== 'string') throw new Error('Invalid BOM identity');
        if (item.childVariationId != null && (!validStock(item.childVariationId) || item.childVariationId === 0)) throw new Error('Invalid variation');
        const internal = isRecord(item.internalProduct) ? item.internalProduct : null;
        const variation = isRecord(item.childVariation) ? item.childVariation : null;
        const product = isRecord(item.childProduct) ? item.childProduct : null;
        const supplier = isRecord(item.supplierItem) ? item.supplierItem : null;
        const source = internal || variation || product || supplier;
        const name = internal?.name || product?.name || supplier?.name;
        const attributes = isRecord(variation?.rawData) && Array.isArray(variation.rawData.attributes) ? variation.rawData.attributes.filter(isRecord).map(attribute => attribute.option || attribute.value).filter(value => typeof value === 'string').join(' / ') : '';
        const suffix = variation ? ` - ${attributes || (typeof variation.sku === 'string' ? variation.sku : `Variant #${item.childVariationId}`)}` : '';
        return {
            id: item.id as string | undefined, childProductId: item.childProductId as string | undefined, childVariationId: item.childVariationId as number | undefined,
            internalProductId: item.internalProductId as string | undefined, supplierItemId: item.supplierItemId as string | undefined,
            displayName: `${internal ? '[Internal] ' : ''}${typeof name === 'string' ? name : 'Unknown component'}${suffix}`,
            quantity, wasteFactor, cost: bomNumber(supplier ? supplier.cost : source?.cogs), isInternal: !!internal,
        };
    });
}
function decodeStock(value: unknown) {
    if (!isRecord(value)) throw new Error('Invalid stock');
    return { effectiveStock: validStock(value.effectiveStock) ? value.effectiveStock : null, currentWooStock: validStock(value.currentWooStock) ? value.currentWooStock : null };
}
function decodeProducts(value: unknown, field: 'products' | 'items'): BOMSearchResultProduct[] {
    if (!isRecord(value) || !Array.isArray(value[field])) throw new Error('Invalid search');
    return value[field].map((item: unknown) => {
        if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || (item.sku != null && typeof item.sku !== 'string')) throw new Error('Invalid component');
        if (item.searchableVariants != null && (!Array.isArray(item.searchableVariants) || !item.searchableVariants.every(variant => isRecord(variant) && validStock(variant.wooId) && variant.wooId > 0 && ['sku', 'attributeString'].every(key => variant[key] == null || typeof variant[key] === 'string')))) throw new Error('Invalid variants');
        return { ...item, id: item.id, name: item.name, cogs: bomNumber(item.cogs), isInternalProduct: field === 'items' } as BOMSearchResultProduct;
    });
}
const decodeWoo = (value: unknown) => decodeProducts(value, 'products');
const decodeInternal = (value: unknown) => decodeProducts(value, 'items');

export const BOMPanel = forwardRef<BOMPanelRef, BOMPanelProps>(function BOMPanel(props, ref) {
    const { token } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    const canViewCogs = hasPermission('view_cogs');
    const child = useRef<BOMPanelRef>(null);
    useImperativeHandle(ref, () => ({ save: () => !canViewCogs ? Promise.resolve(true) : child.current?.save() ?? Promise.resolve(false) }), [canViewCogs]);
    if (!canViewCogs) return null;
    if (!token || !currentAccount || !props.productId) return <p role="alert">Select an account and product to edit the BOM.</p>;
    return <BOMScopes key={JSON.stringify([token, currentAccount.id, props.productId, props.fixedVariationId])} {...props} ref={child} token={token} accountId={currentAccount.id} currency={currentAccount.currency} />;
});
const BOMScopes = forwardRef<BOMPanelRef, Omit<ScopeProps, 'scope'>>(function BOMScopes(props, ref) {
    const [scope, setScope] = useState(props.fixedVariationId ?? 0);
    const [busy, setBusy] = useState(false);
    const transition = useScopedMutation(); const child = useRef<BOMPanelRef>(null);
    useImperativeHandle(ref, () => ({ save: () => transition.isPending() ? Promise.resolve(false) : child.current?.save() ?? Promise.resolve(false) }), [transition]);
    const changeScope = async (next: number) => {
        if (busy || transition.isPending()) return;
        const result = await transition.run(async () => { if (!child.current || !await child.current.save()) throw new Error('BOM not saved'); }, 'Could not save this BOM. Resolve its errors before changing scope.');
        if (result.ok) setScope(next);
    };
    return <section className={`${ui.card} space-y-4 text-slate-900 dark:text-slate-100`}><h3 className="flex items-center gap-2 font-semibold"><Layers size={18} className="text-indigo-500" />BOM Configuration</h3>
        {props.fixedVariationId === undefined && <label className={`${ui.label} max-w-md`}>BOM scope<select disabled={busy || transition.busy} className={ui.input} value={scope} onChange={event => void changeScope(Number(event.target.value))}><option value={0}>Main Product</option>{props.variants?.map(variant => <option key={variant.id} value={variant.id}>Variant #{variant.id} {variant.sku}</option>)}</select></label>}
        {transition.error && <p role="alert" className={ui.alert}>{transition.error}</p>}
        <LoadedBOM key={scope} {...props} scope={scope} ref={child} onBusyChange={setBusy} />
    </section>;
});
const LoadedBOM = forwardRef<BOMPanelRef, ScopeProps & { onBusyChange: (busy: boolean) => void }>(function LoadedBOM(props, ref) {
    const request = useScopedRequest(`/api/inventory/products/${encodeURIComponent(props.productId)}/bom?variationId=${props.scope}`, props.accountId, props.token, decodeBOM);
    const editor = useRef<BOMPanelRef>(null);
    useImperativeHandle(ref, () => ({ save: () => editor.current?.save() ?? Promise.resolve(false) }), []);
    if (request.loading) return <p role="status">Loading BOM...</p>;
    if (request.error || !request.data) return <p role="alert">BOM unavailable. Editing is disabled to protect existing components. <button type="button" onClick={request.retry}>Retry</button></p>;
    return <BOMEditor {...props} initial={request.data} ref={editor} />;
});
const BOMEditor = forwardRef<BOMPanelRef, ScopeProps & { initial: BOMItem[]; onBusyChange: (busy: boolean) => void }>(function BOMEditor({ initial, onBusyChange, ...props }, ref) {
    const [items, setItems] = useState(initial); const [saved, setSaved] = useState(JSON.stringify(initial));
    const [query, setQuery] = useState(''); const debounced = useDebouncedValue(query, 300);
    const [message, setMessage] = useState(''); const [stockVersion, setStockVersion] = useState(0);
    const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const mutation = useScopedMutation(); const pending = useRef(false);
    const dirty = saved !== JSON.stringify(items);
    const totalCost = items.length ? items.reduce((sum, item) => sum + (validBOMValues(item) && Number.isFinite(item.cost) && item.cost >= 0 ? item.quantity * item.cost * (1 + item.wasteFactor) : NaN), 0) : NaN;
    const base = `/api/inventory/products/${encodeURIComponent(props.productId)}/bom`;
    const headers = { Authorization: `Bearer ${props.token}`, 'X-Account-ID': props.accountId, 'Content-Type': 'application/json' };
    const save = async (): Promise<boolean> => {
        if (!mutation.isActive() || pending.current || mutation.isPending()) return false;
        if (!items.every(validBOMValues)) { setMessage('Enter positive quantities and nonnegative waste percentages before saving.'); return false; }
        if (!dirty) return true;
        pending.current = true; onBusyChange(true); setMessage('');
        const result = await mutation.run(async signal => {
            const response = await fetch(base, { method: 'POST', headers, signal, body: JSON.stringify({ variationId: props.scope, items: items.map(item => ({ childProductId: item.childProductId, childVariationId: item.childVariationId, internalProductId: item.internalProductId, supplierItemId: item.supplierItemId, quantity: item.quantity, wasteFactor: item.wasteFactor })) }) });
            if (!response.ok) throw new Error('BOM save rejected');
            const confirmed = decodeBOM(await response.json());
            const signature = (rows: BOMItem[]) => JSON.stringify(rows.map(item => [item.childProductId ?? null, item.childVariationId ?? null, item.internalProductId ?? null, item.supplierItemId ?? null, item.quantity, item.wasteFactor]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
            if (signature(confirmed) !== signature(items)) throw new Error('BOM save incomplete');
            return confirmed;
        }, 'Could not confirm BOM save. Check the saved configuration before retrying.');
        pending.current = false;
        if (!mutation.isActive()) return false;
        onBusyChange(false);
        if (!result.ok) return false;
        const confirmed = result.value;
        const confirmedCost = confirmed.reduce((sum, item) => sum + item.cost * item.quantity * (1 + item.wasteFactor), 0);
        setItems(confirmed); setSaved(JSON.stringify(confirmed)); setStockVersion(value => value + 1); setMessage('BOM saved.');
        try {
            props.onCOGSUpdate?.(Number.isFinite(confirmedCost) ? confirmedCost : null, !!confirmed.length);
            props.onSaveComplete?.();
        } catch { setMessage('BOM saved, but the parent view could not refresh. Do not repeat the save; reload the product.'); }
        return true;
    };
    useImperativeHandle(ref, () => ({ save }));
    const sync = async () => {
        if (dirty || pending.current || mutation.isPending() || !items.length) return;
        pending.current = true; onBusyChange(true); setSyncStatus('idle');
        const result = await mutation.run(async signal => {
            const response = await fetch(`${base}/sync?variationId=${props.scope}`, { method: 'POST', headers, signal });
            const value: unknown = await response.json();
            if (!response.ok || !isRecord(value) || !validStock(value.newStock)) throw new Error('Unconfirmed sync');
            return value.newStock;
        }, 'Could not confirm stock sync. Check WooCommerce before retrying.');
        pending.current = false;
        if (!mutation.isActive()) return;
        onBusyChange(false); setSyncStatus(result.ok ? 'success' : 'error');
        if (result.ok) { setStockVersion(value => value + 1); try { props.onSyncComplete?.(result.value); } catch { setMessage('Stock synced, but the product view could not refresh. Reload the product.'); } }
    };
    const add = (product: BOMSearchResultProduct) => {
        if (mutation.isPending() || product.id === props.productId && !product.isInternalProduct) return;
        if (items.some(item => product.isInternalProduct ? item.internalProductId === product.id : item.childProductId === product.id && item.childVariationId === product.variantId)) { setMessage('This component is already in the BOM.'); return; }
        setItems(current => [...current, { ...(product.isInternalProduct ? { internalProductId: product.id } : { childProductId: product.id, childVariationId: product.variantId }), displayName: product.name, quantity: 1, wasteFactor: 0, cost: bomNumber(product.cogs), isInternal: product.isInternalProduct }]);
        setQuery(''); setSyncStatus('idle');
    };
    return <div className="space-y-4">
        <StockSummary key={stockVersion} {...props} totalCost={totalCost} isSyncing={mutation.busy} disabled={dirty || mutation.busy || !items.length} syncStatus={syncStatus} onSyncToWoo={() => void sync()} />
        {dirty && <p className={ui.notice}>Unsaved BOM changes. Save before syncing stock; buildable units reflect the saved BOM.</p>}
        <label className={ui.label}>Search components<input className={ui.input} placeholder="Search component name or SKU…" disabled={mutation.busy} value={query} onChange={event => setQuery(event.target.value)} /></label>
        {query.trim().length >= 2 && (query !== debounced ? <p role="status">Searching components...</p> : <ComponentSearch key={debounced} {...props} query={debounced} onAdd={add} disabled={mutation.busy} />)}
        <BOMItemsTable items={items} selectedScope={props.scope} currency={props.currency} disabled={mutation.busy} onItemsChange={next => { if (!mutation.isPending()) { setItems(next); setSyncStatus('idle'); } }} />
        {mutation.error && <p role="alert" className={ui.alert}>{mutation.error}</p>}{message && <p role="status" className={ui.notice}>{message}</p>}
        <div className="flex justify-end"><button className={ui.primary} type="button" disabled={mutation.busy || !dirty || !items.every(validBOMValues)} onClick={() => void save()}>{mutation.busy ? 'Working...' : 'Save BOM'}</button></div>
    </div>;
});
function StockSummary(props: ScopeProps & Omit<React.ComponentProps<typeof BOMCostSummary>, 'effectiveStock' | 'currentWooStock'>) {
    const request = useScopedRequest(`/api/inventory/products/${encodeURIComponent(props.productId)}/bom/effective-stock?variationId=${props.scope}`, props.accountId, props.token, decodeStock);
    return <><BOMCostSummary {...props} effectiveStock={!request.loading && !request.error ? request.data?.effectiveStock ?? null : null} currentWooStock={!request.loading && !request.error ? request.data?.currentWooStock ?? null : null} />{request.error && <p role="alert">Stock unavailable. <button type="button" onClick={request.retry}>Retry stock</button></p>}</>;
}
function ComponentSearch({ query, onAdd, disabled, ...props }: ScopeProps & { query: string; onAdd: (product: BOMSearchResultProduct) => void; disabled: boolean }) {
    const woo = useScopedRequest(`/api/products?q=${encodeURIComponent(query)}&limit=8`, props.accountId, props.token, decodeWoo);
    const internal = useScopedRequest(`/api/inventory/internal-products?search=${encodeURIComponent(query)}&limit=8`, props.accountId, props.token, decodeInternal);
    return <BOMSearchDropdown hideSearchInput searchTerm={query} onSearchChange={() => {}} searchResults={[...(woo.data || []), ...(internal.data || [])]} productId={props.productId} onAddProduct={onAdd} currency={props.currency} disabled={disabled} loading={woo.loading || internal.loading} error={woo.error || internal.error} onRetry={() => { woo.retry(); internal.retry(); }} />;
}
