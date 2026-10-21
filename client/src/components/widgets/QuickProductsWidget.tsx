import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { searchProductsLocal, type CachedProduct } from '../../services/db';
import type { WidgetProps } from './WidgetRegistry';
import { widgetCardClass, widgetTitleClass } from './widgetStyles';

export function QuickProductsWidget(props: WidgetProps) {
    const { currentAccount } = useAccount(); const { token } = useAuth();
    if (!currentAccount || !token) return <p role="status">Select an account to search products.</p>;
    return <AccountProducts key={JSON.stringify([currentAccount.id, token])} accountId={currentAccount.id} className={props.className} />;
}
function AccountProducts({ accountId, className = '' }: { accountId: string; className?: string }) {
    const [query, setQuery] = useState('');
    return <section aria-label="Quick products" className={`${widgetCardClass} p-4 h-full text-slate-900 dark:text-white ${className}`}>
        <h3 className={widgetTitleClass}>Quick Products</h3>
        <label className="block my-3 text-sm">Search cached products<input type="search" value={query} onChange={event => setQuery(event.target.value)} className="block w-full p-2 border rounded-lg dark:border-slate-600 bg-transparent" /></label>
        {query.trim() ? <Results key={query} query={query.trim()} accountId={accountId} /> : <p>Type to search locally cached products.</p>}
    </section>;
}
function Results({ accountId, query }: { accountId: string; query: string }) {
    const [results, setResults] = useState<CachedProduct[] | null>(null); const [error, setError] = useState(false); const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let disposed = false;
        const timer = setTimeout(() => {
            setResults(null); setError(false);
            void searchProductsLocal(accountId, query).then(found => {
                if (disposed) return;
                if (!found.every(item => item.accountId === accountId && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.sku === 'string')) throw new Error('Invalid cached products');
                setResults(found.slice(0, 5));
            }).catch(() => { if (!disposed) setError(true); });
        }, 150);
        return () => { disposed = true; clearTimeout(timer); };
    }, [accountId, query, attempt]);
    if (error) return <p role="alert">Local search unavailable. <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry search</button></p>;
    if (!results) return <p role="status">Searching cached products...</p>;
    if (!results.length) return <p role="status">No cached products match “{query}”.</p>;
    return <ul>{results.map(product => <li key={product.id}><Link to={`/inventory/product/${encodeURIComponent(product.id)}`} className="block p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700"><span className="block font-medium">{product.name}</span><span className="text-xs">{product.sku}</span></Link></li>)}</ul>;
}
export default QuickProductsWidget;
