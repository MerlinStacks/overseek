import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';

/** Rule values stay comma-separated IDs for compatibility with existing string-valued conditions. */
export function ProductTagPicker({ value, onChange }: { value: string; onChange: (ids: string) => void }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const id = useId();
    const root = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const [options, setOptions] = useState<Array<{ id: number; name: string }>>([]);
    const [names, setNames] = useState<Record<string, string>>({});
    const [pages, setPages] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [active, setActive] = useState(-1);
    const selectedIds = value.split(',').map(item => item.trim()).filter(Boolean);
    const toggle = (tagId: string) => {
        onChange((selectedIds.includes(tagId) ? selectedIds.filter(item => item !== tagId) : [...selectedIds, tagId]).join(','));
    };

    useEffect(() => { setOptions([]); setNames({}); setQuery(''); setPage(1); setOpen(false); }, [currentAccount?.id]);
    useEffect(() => {
        const dismiss = (event: PointerEvent) => {
            if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, []);
    useEffect(() => {
        if (open && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
    }, [active, open, id]);
    useEffect(() => {
        if (!token || !currentAccount?.id) return;
        const controller = new AbortController();
        setLoading(true); setError(''); setActive(-1);
        const timeout = setTimeout(async () => {
            try {
                const response = await fetch(`/api/products/tags?limit=50&page=${page}&q=${encodeURIComponent(query)}`, {
                    headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount.id }, signal: controller.signal,
                });
                if (!response.ok) throw new Error('Unable to load WooCommerce tags. Try searching again.');
                const result = await response.json();
                if (controller.signal.aborted) return;
                const items: Array<{ id: number; name: string }> = result.items || [];
                setOptions(items);
                setNames(current => ({ ...current, ...Object.fromEntries(items.map(item => [String(item.id), item.name])) }));
                setPages(result.totalPages || 0);
            } catch (err) {
                if (!controller.signal.aborted) { setOptions([]); setError(err instanceof Error ? err.message : 'Unable to load tags'); }
            } finally { if (!controller.signal.aborted) setLoading(false); }
        }, 250);
        return () => { controller.abort(); clearTimeout(timeout); };
    }, [token, currentAccount?.id, query, page]);

    return <div ref={root} className="relative min-w-0" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
        <div className="rounded-lg border border-gray-300 bg-white focus-within:border-[var(--primary-color)] focus-within:ring-2 focus-within:ring-[var(--focus-color)] dark:border-slate-600 dark:bg-slate-800">
            {selectedIds.length > 0 && <div className="flex flex-wrap gap-1 px-2 pt-2">
                {selectedIds.map(tagId => <span key={tagId} className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--brand-border)] bg-[var(--brand-subtle)] px-1.5 py-0.5 text-xs text-[var(--brand-text)]">
                    <span className="truncate">{names[tagId] || `Tag #${tagId}`}</span>
                    <button type="button" aria-label={`Remove ${names[tagId] || `tag #${tagId}`}`} onClick={() => toggle(tagId)} className="shrink-0 rounded hover:bg-black/5"><X size={12} /></button>
                </span>)}
            </div>}
            <div className="flex items-center">
                <input ref={input} role="combobox" aria-label="WooCommerce product tags" aria-expanded={open} aria-controls={id} aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
                    value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setPage(1); setOpen(true); }}
                    onKeyDown={event => {
                        if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault(); setOpen(true);
                            setActive(current => options.length ? (event.key === 'ArrowDown' ? (current + 1) % options.length : (current <= 0 ? options.length - 1 : current - 1)) : -1);
                        }
                        if (event.key === 'Enter') { event.preventDefault(); if (open && !loading && options[active]) toggle(String(options[active].id)); else setOpen(true); }
                    }}
                    placeholder={selectedIds.length ? 'Search more tags…' : 'Select tags…'} className="min-w-0 w-full rounded-lg border-0 bg-transparent px-2 py-1.5 text-sm text-gray-900 outline-none focus:ring-0 dark:text-slate-100" />
                <button type="button" aria-label="Toggle product tags" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => { input.current?.focus(); setOpen(!open); }} className="shrink-0 px-2 text-gray-500"><ChevronDown size={14} /></button>
            </div>
        </div>
        {open && <div className="absolute right-0 z-30 mt-1 w-full min-w-60 max-w-[calc(100vw-3rem)] rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-600 dark:bg-slate-800">
            <div id={id} role="listbox" aria-label="WooCommerce product tags" aria-multiselectable="true" className="max-h-52 overflow-y-auto">
                {!loading && options.map((option, index) => <div key={option.id} id={`${id}-${index}`} role="option" aria-selected={selectedIds.includes(String(option.id))}
                    onMouseDown={event => event.preventDefault()} onClick={() => toggle(String(option.id))} onMouseEnter={() => setActive(index)}
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm ${active === index ? 'bg-[var(--brand-subtle)] text-[var(--brand-text)]' : 'text-gray-700 dark:text-slate-200'}`}>
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-gray-300">{selectedIds.includes(String(option.id)) && <Check size={12} />}</span>{option.name}
                </div>)}
            </div>
            {loading && <p role="status" className="p-2 text-xs text-gray-500">Loading tags…</p>}
            {error && <p role="alert" className="p-2 text-xs text-red-600">{error}</p>}
            {!loading && !error && !options.length && <p className="p-2 text-xs text-gray-500">No matching tags.</p>}
            {!loading && pages > 1 && <div className="mt-1 flex items-center justify-between border-t border-gray-100 px-2 pt-2 text-xs text-gray-600 dark:text-slate-300">
                <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded px-1 py-1 hover:bg-gray-100 disabled:opacity-40">Previous</button>
                <span>{page} / {pages}</span>
                <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded px-1 py-1 hover:bg-gray-100 disabled:opacity-40">Next</button>
            </div>}
        </div>}
    </div>;
}
