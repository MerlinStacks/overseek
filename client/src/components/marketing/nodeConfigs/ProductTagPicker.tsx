import { useEffect, useId, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';

/** Search the store taxonomy, not just the first page of locally loaded tags. */
export function ProductTagPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const id = useId();
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const [options, setOptions] = useState<Array<{ id: number; name: string }>>([]);
    const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
    const [pages, setPages] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { setOptions([]); setSelected(null); setQuery(''); setPage(1); }, [currentAccount?.id]);
    useEffect(() => {
        if (!token || !currentAccount?.id) return;
        const controller = new AbortController();
        setLoading(true);
        setError('');
        const timeout = setTimeout(async () => {
            try {
                const response = await fetch(`/api/products/tags?limit=50&page=${page}&q=${encodeURIComponent(query)}`, {
                    headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount.id }, signal: controller.signal
                });
                if (!response.ok) throw new Error('Unable to load WooCommerce tags. Try searching again.');
                const result = await response.json();
                if (controller.signal.aborted) return;
                setOptions(result.items || []);
                setPages(result.totalPages || 0);
            } catch (err) {
                if (!controller.signal.aborted) { setOptions([]); setError(err instanceof Error ? err.message : 'Unable to load tags'); }
            } finally { if (!controller.signal.aborted) setLoading(false); }
        }, 250);
        return () => { controller.abort(); clearTimeout(timeout); };
    }, [token, currentAccount?.id, query, page]);
    const containsSelection = options.some(option => String(option.id) === value);
    return <div className="min-w-0 space-y-1">
        <input aria-label="Search WooCommerce product tags" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search WooCommerce tags…" className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800" aria-controls={id} />
        <select id={id} aria-label="WooCommerce product tag" value={value} disabled={loading} onChange={event => {
            const option = options.find(item => String(item.id) === event.target.value);
            setSelected(option ? { id: String(option.id), name: option.name } : null);
            onChange(event.target.value);
        }} className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800">
            <option value="">{loading ? 'Loading tags…' : 'Select tag…'}</option>
            {value && !containsSelection && <option value={value}>{selected?.id === value ? selected.name : `Selected tag #${value}`}</option>}
            {options.map(option => <option key={option.id} value={String(option.id)}>{option.name}</option>)}
        </select>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {!loading && !error && !options.length && <p className="text-xs text-gray-500">No matching tags.</p>}
        {pages > 1 && <div className="flex items-center gap-2 text-xs">
            <button type="button" disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>{page} / {pages}</span>
            <button type="button" disabled={loading || page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>}
    </div>;
}
