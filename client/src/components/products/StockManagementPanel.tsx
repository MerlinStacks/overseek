import { forwardRef, useId, useImperativeHandle, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import { isRecord } from '../../utils/responseValidation';
import { ChevronDown, Package } from 'lucide-react';
import { workspaceStyles as ui } from '../ui/workspaceStyles';

interface Props {
    productWooId: number;
    variants?: Array<{ id: number; sku?: string; attributes?: Array<{ name: string; option: string }>; stock_quantity?: number | null; stock_status?: string }>;
    onStockChange?: (newStock: number, variantId?: number) => void;
}
export interface StockManagementPanelRef { save(): Promise<boolean> }
interface Variant { wooId: number; sku?: string; stockQuantity: number | null; manageStock: boolean; isBOMBased?: boolean; attributes?: string }
interface StockInfo { stockQuantity: number | null; isBOMBased: boolean; manageStock: boolean; isVariable?: boolean; variants?: Variant[] }
const stockValue = (value: unknown) => value === null || (typeof value === 'number' && Number.isSafeInteger(value));
function decodeStock(value: unknown): StockInfo {
    if (!isRecord(value) || !stockValue(value.stockQuantity) || typeof value.isBOMBased !== 'boolean' || typeof value.manageStock !== 'boolean' || (value.isVariable != null && typeof value.isVariable !== 'boolean') ||
        (value.variants !== undefined && (!Array.isArray(value.variants) || !value.variants.every(item => isRecord(item) && typeof item.wooId === 'number' && Number.isSafeInteger(item.wooId) && item.wooId > 0 && stockValue(item.stockQuantity) && typeof item.manageStock === 'boolean' && (item.isBOMBased === undefined || typeof item.isBOMBased === 'boolean') && ['sku', 'attributes'].every(key => item[key] == null || typeof item[key] === 'string')))) ||
        (value.isVariable && (!Array.isArray(value.variants) || value.variants.length === 0))) throw new Error('Invalid stock information');
    const data = value as unknown as StockInfo;
    if (data.variants && new Set(data.variants.map(item => item.wooId)).size !== data.variants.length) throw new Error('Duplicate variants');
    return data;
}
function quantity(value: string): number | null {
    const number = /^\d+$/.test(value.trim()) ? Number(value) : NaN;
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
export const StockManagementPanel = forwardRef<StockManagementPanelRef, Props>(function StockManagementPanel(props, ref) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount || !Number.isSafeInteger(props.productWooId) || props.productWooId < 1) return <p role="status">Select an account and product to manage stock.</p>;
    return <ScopedStock key={JSON.stringify([token, currentAccount.id, props.productWooId])} {...props} ref={ref} token={token} accountId={currentAccount.id} />;
});
const ScopedStock = forwardRef<StockManagementPanelRef, Props & { token: string; accountId: string }>(function ScopedStock(props, ref) {
    const { data, loading, error, retry } = useScopedRequest(`/api/products/${props.productWooId}/stock`, props.accountId, props.token, decodeStock);
    const editor = useRef<StockManagementPanelRef>(null);
    useImperativeHandle(ref, () => ({ save: () => editor.current?.save() ?? Promise.resolve(false) }), []);
    if (loading) return <p role="status">Loading stock...</p>;
    if (error || !data) return <p role="alert">Could not load stock information. <button type="button" onClick={retry}>Retry stock</button></p>;
    return <StockEditor {...props} initial={data} ref={editor} />;
});
const StockEditor = forwardRef<StockManagementPanelRef, Props & { token: string; accountId: string; initial: StockInfo }>(function StockEditor({ productWooId, token, accountId, initial, onStockChange }, ref) {
    const [stock, setStock] = useState(initial);
    const [edits, setEdits] = useState<Record<number, string>>(() => Object.fromEntries(initial.variants?.map(item => [item.wooId, item.stockQuantity?.toString() ?? '']) ?? [[0, initial.stockQuantity?.toString() ?? '']]));
    const [expanded, setExpanded] = useState(true); const id = useId();
    const [validation, setValidation] = useState<string | null>(null); const [savingId, setSavingId] = useState<number | null>(null);
    const mutation = useScopedMutation();
    const rows: Variant[] = stock.variants?.length ? stock.variants : [{ wooId: 0, stockQuantity: stock.stockQuantity, manageStock: stock.manageStock, attributes: 'Product' }];
    const readOnlyParentBOM = stock.isBOMBased && !stock.isVariable;
    const save = async (onlyId?: number): Promise<boolean> => {
        if (mutation.isPending()) return false;
        if (readOnlyParentBOM) return true;
        const targets = rows.filter(row => !row.isBOMBased && (onlyId === undefined || row.wooId === onlyId) && edits[row.wooId] !== (row.stockQuantity?.toString() ?? ''));
        if (!targets.length) return !mutation.busy;
        if (targets.some(row => quantity(edits[row.wooId] ?? '') === null)) { setValidation('Enter a whole stock quantity of zero or greater.'); return false; }
        setValidation(null);
        const result = await mutation.run(async signal => {
            for (const row of targets) {
                if (signal.aborted) throw new Error('Cancelled');
                const value = quantity(edits[row.wooId])!; setSavingId(row.wooId);
                const path = row.wooId ? `/api/products/${productWooId}/variants/${row.wooId}/stock` : `/api/products/${productWooId}/stock`;
                const response = await fetch(path, { method: 'PUT', signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' }, body: JSON.stringify({ stockQuantity: value }) });
                if (!response.ok) throw new Error('Stock save failed');
                const saved: unknown = await response.json();
                if (!isRecord(saved) || saved.success !== true || saved.stockQuantity !== value || signal.aborted) throw new Error('Invalid stock confirmation');
                setStock(previous => row.wooId ? { ...previous, variants: previous.variants?.map(item => item.wooId === row.wooId ? { ...item, stockQuantity: value, manageStock: true } : item) } : { ...previous, stockQuantity: value, manageStock: true });
                try { void Promise.resolve(onStockChange?.(value, row.wooId || undefined)).catch(() => {}); } catch { /* Saved stock must not be retried because of a callback failure. */ }
            }
        }, 'Could not confirm all stock updates. Saved rows are retained; check stock before retrying.');
        if (mutation.isActive()) setSavingId(null);
        return result.ok;
    };
    useImperativeHandle(ref, () => ({ save: () => save() }));
    return <section aria-label="Stock management" className="p-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 space-y-4">
        <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)} className="flex w-full flex-wrap items-center gap-2 text-left text-sm font-semibold"><Package size={18} className="text-indigo-500" />Stock On Hand{stock.isBOMBased && <span className={ui.badge}>BOM Calculated</span>}<ChevronDown size={16} className={`ml-auto text-slate-400 ${expanded ? 'rotate-180' : ''}`} /></button>
        {(validation || mutation.error) && <p role="alert" className={ui.alert}>{validation || mutation.error}</p>}
        {stock.isVariable && stock.isBOMBased && <p className={ui.notice}>Independent variant BOM capacities may share components; total capacity is unavailable.</p>}
        <div id={id} hidden={!expanded}>{readOnlyParentBOM ? <><p className="text-3xl font-semibold">{stock.stockQuantity ?? 'Unavailable'}</p><p>Stock is calculated from BOM components and cannot be edited here.</p></> : <fieldset disabled={mutation.busy} className="space-y-4">
            {rows.map(row => row.isBOMBased ? <p className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900/50" key={row.wooId}>{row.attributes || row.sku || `Variation #${row.wooId}`} stock: {row.stockQuantity ?? 'Unavailable'} (BOM calculated; read-only)</p> : <div key={row.wooId} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 p-3 dark:border-slate-700"><label htmlFor={`${id}-${row.wooId}`} className="min-w-32 flex-1 text-sm font-medium">{row.attributes || row.sku || `Variation #${row.wooId}`} stock</label><span className={ui.muted}>{row.sku}</span><button className={`${ui.secondary} px-3`} type="button" aria-label={`Decrease ${row.wooId || 'product'} stock`} onClick={() => { const value = quantity(edits[row.wooId]); if (value !== null) setEdits(previous => ({ ...previous, [row.wooId]: String(Math.max(0, value - 1)) })); }}>−</button>
                <input id={`${id}-${row.wooId}`} type="number" min="0" step="1" value={edits[row.wooId] ?? ''} onChange={event => setEdits(previous => ({ ...previous, [row.wooId]: event.target.value }))} className="w-24 p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" />
                <button className={`${ui.secondary} px-3`} type="button" aria-label={`Increase ${row.wooId || 'product'} stock`} onClick={() => { const value = quantity(edits[row.wooId]); if (value !== null && Number.isSafeInteger(value + 1)) setEdits(previous => ({ ...previous, [row.wooId]: String(value + 1) })); }}>+</button>
                <button type="button" disabled={edits[row.wooId] === (row.stockQuantity?.toString() ?? '')} onClick={() => void save(row.wooId)} className="px-3 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50">{savingId === row.wooId ? 'Saving...' : row.wooId ? 'Save variant' : 'Update Stock'}</button>
            </div>)}
            <p className="text-xs text-slate-500 dark:text-slate-400">Saving enables stock tracking. Stock updates are processed one at a time.</p>
        </fieldset>}</div>
        {mutation.busy && <p role="status">Saving stock...</p>}
    </section>;
});
