import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

export interface WooTerm {
    id: number;
    name: string;
}

interface WooTermFieldProps {
    kind: 'categories' | 'tags';
    selected: WooTerm[];
    onChange?: (terms: WooTerm[]) => void;
}

export function WooTermField({ kind, selected, onChange }: WooTermFieldProps) {
    return <div className="space-y-2">
        {selected.length > 0 ? <div className="flex flex-wrap gap-2">
            {selected.map(term => <span key={term.id} className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full border transition-colors ${kind === 'categories'
                ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800 dark:hover:bg-blue-900'
                : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800 dark:hover:bg-amber-900'}`}>
                {kind === 'tags' ? '#' : ''}{term.name}
                {onChange && <button type="button" aria-label={`Remove ${kind === 'tags' ? 'tag' : 'category'} ${term.name}`}
                    className="rounded-sm p-1 focus-visible:outline-2 focus-visible:outline-indigo-500"
                    onClick={() => onChange(selected.filter(item => item.id !== term.id))}><X size={12} aria-hidden="true" /></button>}
            </span>)}
        </div> : <p className="text-sm text-gray-400 italic">No {kind} assigned</p>}
        {onChange && <>
            {selected.length > 0 && <button type="button" className="text-xs text-indigo-600 dark:text-indigo-300 underline" onClick={() => onChange([])}>Clear {kind}</button>}
            <AccountTermChoices kind={kind} selected={selected} onChange={onChange} />
        </>}
    </div>;
}

function AccountTermChoices(props: Required<WooTermFieldProps>) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status" className="text-sm text-gray-500 dark:text-gray-400">Select an account and sign in to load {props.kind}.</p>;
    // Remount immediately on scope changes, so old account choices cannot be used.
    return <TermChoices key={JSON.stringify([currentAccount.id, token, props.kind])} {...props} accountId={currentAccount.id} token={token} />;
}

function TermChoices({ kind, selected, onChange, accountId, token }: Required<WooTermFieldProps> & { accountId: string; token: string }) {
    const searchId = useId();
    const [search, setSearch] = useState('');
    const [items, setItems] = useState<WooTerm[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                const terms = new Map<number, WooTerm>();
                for (let page = 1; ; page++) {
                    const response = await fetch(`/api/products/${kind}?page=${page}&limit=100`, {
                        headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId },
                        signal: controller.signal
                    });
                    if (controller.signal.aborted) return;
                    if (!response.ok) throw new Error('Term listing failed');
                    const data = await response.json();
                    if (controller.signal.aborted) return;
                    if (!Array.isArray(data.items) || !data.items.every((term: WooTerm) => term && Number.isInteger(term.id) && typeof term.name === 'string')) {
                        throw new Error('Invalid term listing');
                    }
                    for (const { id, name } of data.items as WooTerm[]) terms.set(id, { id, name });
                    const totalPages = Number(data.totalPages);
                    if (totalPages > 0 ? page >= totalPages : data.items.length < 100) break;
                }
                setItems([...terms.values()]);
            } catch {
                if (!controller.signal.aborted) setError(true);
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void load();
        return () => controller.abort();
    }, [accountId, token, kind, attempt]);

    // Keep selected terms available even when Woo no longer returns them.
    const options = new Map(items.map(term => [term.id, term]));
    selected.forEach(term => options.set(term.id, term));
    const matches = [...options.values()].filter(term => term.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

    return <div className="space-y-2 text-sm text-gray-700 dark:text-gray-200">
        <label htmlFor={searchId} className="sr-only">Search {kind}</label>
        <input id={searchId} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${kind}…`}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        {loading && <p role="status">Loading {kind}…</p>}
        {error && <div role="alert">Could not load {kind}. <button type="button" className="underline text-indigo-600 dark:text-indigo-300" onClick={() => {
            setLoading(true);
            setError(false);
            setAttempt(value => value + 1);
        }}>Retry {kind}</button></div>}
        <fieldset disabled={loading || error} className="max-h-48 overflow-y-auto space-y-1 disabled:opacity-60">
            <legend className="sr-only">Select {kind}</legend>
            {matches.map(term => <label key={term.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-100 dark:hover:bg-slate-700">
                <input type="checkbox" className="accent-indigo-600" checked={selected.some(item => item.id === term.id)} onChange={event => onChange(event.target.checked
                    ? [...selected, term]
                    : selected.filter(item => item.id !== term.id))} />
                <span>{term.name}</span>
            </label>)}
            {!loading && !error && matches.length === 0 && <p>No {kind} found.</p>}
        </fieldset>
    </div>;
}
