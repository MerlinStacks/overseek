import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { usePermissions } from '../../hooks/usePermissions';
import { readBoundedBytes } from '../../utils/boundedResponse';
import { Package, Search, X } from 'lucide-react';
import { workspaceStyles as ui } from '../ui/workspaceStyles';
export interface ProductSelection { productId: string; wooId: number; variationWooId?: number; name: string; sku?: string; price?: number; cogs?: number; image?: string }
interface Props { onSelect: (product: ProductSelection) => void; onClear?: () => void; placeholder?: string; disabled?: boolean; initialValue?: string }
const text = z.string().max(500), id = z.number().int().positive().safe();
const productSchema = z.object({ id: text.min(1), woo_id: id.optional(), wooId: id.optional(), name: text.min(1), sku: text.nullish(), type: z.string().max(50).optional(), hasBOM: z.boolean().optional(), searchableVariants: z.array(z.object({ wooId: id, sku: text.nullish(), attributeString: text.optional() })).max(100).optional() }).refine(value => (value.woo_id ?? value.wooId) !== undefined && (value.woo_id === undefined || value.wooId === undefined || value.woo_id === value.wooId));
export function ProductSearchInput(props: Props) {
    const { token, user } = useAuth(), { currentAccount } = useAccount();
    return <SearchScope key={JSON.stringify([user?.id, token, currentAccount?.id, props.initialValue, props.disabled])} {...props} token={token ?? ''} accountId={currentAccount?.id ?? ''} />;
}
function SearchScope({ onSelect, onClear, placeholder = 'Search by SKU or product name', disabled = false, initialValue = '', token, accountId }: Props & { token: string; accountId: string }) {
    const { hasPermission } = usePermissions(), allowed = !disabled && !!token && !!accountId && hasPermission('view_products');
    const [query, setQuery] = useState(initialValue), [committed, setCommitted] = useState(!!initialValue), [open, setOpen] = useState(false), [selected, setSelected] = useState(-1);
    const [result, setResult] = useState<{ query: string; items: ProductSelection[]; state: string }>({ query: '', items: [], state: 'idle' });
    const listId = useId(), inputId = useId();
    useEffect(() => {
        if (!allowed || query.trim().length < 2 || committed) return;
        const controller = new AbortController(); let disposed = false;
        const timer = setTimeout(() => {
            setResult({ query, items: [], state: 'loading' });
            void (async () => {
                try {
                    const response = await fetch(`/api/products?q=${encodeURIComponent(query.trim())}&limit=20`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId } });
                    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error('Unavailable'); } const data = JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 1048576)));
                    const products = z.array(productSchema).max(20).parse(Array.isArray(data) ? data : data?.products);
                    const items: ProductSelection[] = [];
                    for (const product of products) {
                        if (product.hasBOM) continue;
                        if (product.type === 'variable') {
                            if (new Set(product.searchableVariants?.map(value => value.wooId)).size !== product.searchableVariants?.length) throw new Error('Duplicate variation');
                            for (const variation of product.searchableVariants ?? []) items.push({ productId: product.id, wooId: (product.woo_id ?? product.wooId)!, variationWooId: variation.wooId, name: `${product.name} — ${variation.attributeString || `Variation ${variation.wooId}`}`, sku: variation.sku ?? undefined });
                        } else if (product.type === 'simple') items.push({ productId: product.id, wooId: (product.woo_id ?? product.wooId)!, name: product.name, sku: product.sku ?? undefined });
                    }
                    if (new Set(items.map(item => `${item.productId}:${item.variationWooId ?? ''}`)).size !== items.length) throw new Error('Duplicate identity');
                    items.sort((a, b) => Number(b.sku?.toLowerCase() === query.trim().toLowerCase()) - Number(a.sku?.toLowerCase() === query.trim().toLowerCase()));
                    if (!disposed) setResult({ query, items: items.slice(0, 50), state: 'observed' });
                } catch { if (!disposed) setResult({ query, items: [], state: 'unavailable' }); }
            })();
        }, 300);
        return () => { disposed = true; clearTimeout(timer); controller.abort(); };
    }, [query, allowed, committed, token, accountId]);
    const items = allowed && result.query === query && !committed ? result.items : [];
    const choose = (index: number) => { if (!allowed || !items[index]) return; const item = items[index]; onSelect(item); setQuery(item.name); setCommitted(true); setOpen(false); setSelected(-1); };
    return <div className="relative min-w-0 text-slate-900 dark:text-slate-100"><label htmlFor={inputId} className="sr-only">Search products</label><Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-slate-400" /><input id={inputId} role="combobox" aria-autocomplete="list" aria-controls={listId} aria-expanded={open && allowed} aria-activedescendant={open && items[selected] ? `${listId}-${selected}` : undefined} className={`${ui.input} pl-9 pr-10`} maxLength={200} value={query} placeholder={placeholder} disabled={!allowed} onFocus={() => setOpen(true)} onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node)) setOpen(false); }} onChange={event => { if (committed) onClear?.(); setCommitted(false); setQuery(event.target.value); setSelected(-1); setOpen(true); }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); setSelected(-1); } if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setSelected(value => items.length ? (value + (event.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length : -1); } if (event.key === 'Enter' && open) { event.preventDefault(); choose(selected); } }} /><button className="absolute right-2 top-2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-slate-200" type="button" aria-label="Clear product selection" disabled={!allowed} onClick={() => { setQuery(''); setCommitted(false); setOpen(false); setSelected(-1); onClear?.(); }}><X size={16} /></button>
        {open && allowed && !committed && query.trim().length >= 2 && <div className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"><p role="status" className={`border-b border-slate-100 px-3 py-2 dark:border-slate-700 ${ui.muted}`}>{result.query !== query || result.state === 'loading' ? 'Searching…' : result.state === 'unavailable' ? 'Product search unavailable; no selection is admitted.' : `${items.length} selectable rows from up to 20 local products / 50 rows. BOMs, unknown types and unresolved variants excluded. Coverage is partial; costs/currency not established.`}</p><div role="listbox" id={listId}>{items.map((item, index) => <button type="button" role="option" aria-selected={selected === index} id={`${listId}-${index}`} key={`${item.productId}:${item.variationWooId ?? ''}`} className={`flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors ${selected === index ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}><Package size={16} className="mt-0.5 shrink-0 text-slate-400" /><span className="min-w-0"><span className="block break-words text-sm font-medium">{item.name}</span>{item.sku && <span className={`mt-1 block break-all font-mono ${ui.muted}`}>{item.sku}</span>}</span></button>)}</div></div>}
    </div>;
}
