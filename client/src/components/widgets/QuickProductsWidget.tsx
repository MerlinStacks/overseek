/**
 * QuickProductsWidget - Fast local product search using Hot Tier
 * 
 * Provides instant search results from IndexedDB cache.
 */

import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { Search, Package, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../../context/AccountContext';
import { searchProductsLocal, CachedProduct } from '../../services/db';
import { WidgetProps } from './WidgetRegistry';

export function QuickProductsWidget({ className }: WidgetProps) {
    const { currentAccount } = useAccount();
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<CachedProduct[]>([]);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        if (!currentAccount?.id || !query.trim()) {
            setResults([]);
            return;
        }

        const search = async () => {
            setSearching(true);
            try {
                const found = await searchProductsLocal(currentAccount.id, query);
                setResults(found.slice(0, 5));
            } catch (error) {
                Logger.error('Local search failed', { error: error });
            } finally {
                setSearching(false);
            }
        };

        const timer = setTimeout(search, 150);
        return () => clearTimeout(timer);
    }, [query, currentAccount?.id]);

    return (
        <div className={`bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 p-4 h-full flex flex-col shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)] ${className}`}>
            <div className="flex items-center gap-2 mb-3">
                <Package className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <h3 className="font-semibold text-slate-900 dark:text-white">Quick Products</h3>
                <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">⚡ Instant</span>
            </div>

            <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search cached products..."
                    className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-600 bg-transparent rounded-lg text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-hidden"
                />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1">
                {query && results.length === 0 && !searching && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-4">
                        No cached products match "{query}"
                    </p>
                )}

                {results.map((product) => (
                    <div
                        key={product.id}
                        onClick={() => navigate(`/inventory/product/${product.id}`)}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer group"
                    >
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                {product.name}
                            </p>
                            {product.sku && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                    SKU: {product.sku}
                                </p>
                            )}
                        </div>
                        <ExternalLink className="w-4 h-4 text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                ))}

                {!query && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
                        Type to search locally cached products
                    </p>
                )}
            </div>
        </div>
    );
}

export default QuickProductsWidget;
