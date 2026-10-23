import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface Props {
    kind: 'product' | 'category';
    value: string;
    label?: string;
    onChange: (value: string, label?: string) => void;
}

/** Search the full catalogue rather than restricting rules to the first page. */
export function PurchaseTargetPicker({ kind, value, label, onChange }: Props) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [query, setQuery] = useState('');
    const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        setOptions([]);
        setError(false);
        if (value || !token || !currentAccount?.id) return;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                const response = await fetch(`/api/products${kind === 'category' ? '/categories' : ''}?q=${encodeURIComponent(query)}&limit=20`, {
                    headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount.id },
                    signal: controller.signal
                });
                if (!response.ok) throw new Error('Search failed');
                const data = await response.json();
                const items = data.items || data.products || [];
                if (!controller.signal.aborted) setOptions(items.map((item: { id: string | number; wooId?: number; woo_id?: number; name: string }) => ({
                    id: String(kind === 'category' ? item.id : item.wooId ?? item.woo_id ?? ''), name: item.name
                })).filter((item: { id: string }) => Number(item.id) > 0));
            } catch {
                if (!controller.signal.aborted) setError(true);
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }, 300);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [query, kind, value, token, currentAccount?.id]);

    if (value) return <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">
        <span className="truncate">{label || `${kind === 'product' ? 'Product' : 'Category'} #${value}`}</span>
        <button type="button" onClick={() => { setQuery(''); onChange(''); }} className="shrink-0 text-[var(--brand-text)]">Change</button>
    </div>;

    return <div className="min-w-0 space-y-2">
        <input aria-label={`Search ${kind}`} placeholder={`Search ${kind === 'product' ? 'products by name or SKU' : 'categories'}…`} value={query} onChange={event => setQuery(event.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-[var(--focus-color)] dark:border-slate-600 dark:bg-slate-800" />
        <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-800">
            {loading ? <p className="p-2 text-gray-500" role="status">Searching…</p> : error ? <p className="p-2 text-red-600" role="alert">Could not load {kind === 'product' ? 'products' : 'categories'}. Change the search to retry.</p> : options.length ? options.map(option =>
                <button key={option.id} type="button" onClick={() => onChange(option.id, option.name)} className="block w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-700">{option.name} <span className="text-xs text-gray-400">#{option.id}</span></button>
            ) : <p className="p-2 text-gray-500">No results. Try another search.</p>}
        </div>
    </div>;
}
