
import React, { useEffect, useState } from 'react';
import { Logger } from '../../utils/logger';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { Search, Package, FileText, Settings, LayoutDashboard, Truck, Users, BarChart2, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface SearchResult {
    id: string | number;
    title: string;
    subtitle?: string;
    type: 'product' | 'order' | 'semantic';
    similarity?: number;
}

export function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [semanticResults, setSemanticResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [semanticMode, setSemanticMode] = useState(false);
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen((open) => !open);
            }
        };

        document.addEventListener('keydown', down);
        return () => document.removeEventListener('keydown', down);
    }, []);

    useEffect(() => {
        if (!query || !token || !currentAccount) {
            setResults([]);
            setSemanticResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                // Determine what to search based on query type or just parallel search
                // For now, let's just search products and orders if query length > 2
                if (query.length < 2) return;

                const searches: Promise<Response>[] = [
                    fetch(`/api/products?q=${encodeURIComponent(query)}&limit=5`, {
                        headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
                    }),
                    fetch(`/api/sync/orders/search?q=${encodeURIComponent(query)}&limit=5`, {
                        headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
                    })
                ];

                // Add semantic search if mode is enabled and query is descriptive
                if (semanticMode && query.length >= 3) {
                    searches.push(
                        fetch(`/api/search/semantic?q=${encodeURIComponent(query)}&limit=5`, {
                            headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
                        })
                    );
                }

                const [productsRes, ordersRes, semanticRes] = await Promise.allSettled(searches);

                const newResults: SearchResult[] = [];

                if (productsRes.status === 'fulfilled' && productsRes.value.ok) {
                    const data = await productsRes.value.json();
                    if (data.products) {
                        newResults.push(...data.products.map((p: any) => ({
                            id: p.id,
                            title: p.name,
                            subtitle: p.sku,
                            type: 'product' as const
                        })));
                    }
                }

                if (ordersRes.status === 'fulfilled' && ordersRes.value.ok) {
                    const data = await ordersRes.value.json();
                    const orders = data.orders || (Array.isArray(data) ? data : []);
                    newResults.push(...orders.map((o: any) => ({
                        id: o.id,
                        title: `Order #${o.id}`,
                        subtitle: `${o.billing?.first_name} ${o.billing?.last_name} - ${o.status}`,
                        type: 'order' as const
                    })));
                }

                setResults(newResults);

                // Handle semantic results separately
                if (semanticRes && semanticRes.status === 'fulfilled' && semanticRes.value.ok) {
                    const data = await semanticRes.value.json();
                    if (Array.isArray(data)) {
                        setSemanticResults(data.map((r: any) => ({
                            id: r.id,
                            title: r.name,
                            subtitle: `${Math.round(r.similarity * 100)}% match`,
                            type: 'semantic' as const,
                            similarity: r.similarity
                        })));
                    }
                } else {
                    setSemanticResults([]);
                }
            } catch (err) {
                Logger.error('Search failed', { error: err });
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [query, token, currentAccount, semanticMode]);

    const runCommand = (command: () => void) => {
        setOpen(false);
        command();
    };

    if (!open) return null;

    return (
        <Command.Dialog
            open={open}
            onOpenChange={setOpen}
            label="Global Command Menu"
            shouldFilter={false}
            className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-slate-900/40 backdrop-blur-sm transition-all animate-in fade-in duration-200"
            onClick={(e) => {
                if (e.target === e.currentTarget) setOpen(false);
            }}
        >
            <div className="w-full max-w-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl rounded-2xl shadow-2xl shadow-black/20 border border-slate-200/50 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200 ring-1 ring-black/5 dark:ring-white/5 relative transform">
                {/* Gradient accent top line */}
                <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r transition-all duration-500 ${semanticMode ? 'from-purple-500 via-fuchsia-500 to-purple-500' : 'from-blue-500 via-cyan-500 to-blue-500'}`} />

                <div className="flex items-center border-b border-slate-200/60 dark:border-slate-800 px-5 pt-3 pb-2">
                    <Search className={`w-5 h-5 mr-3 transition-colors ${semanticMode ? 'text-purple-500' : 'text-slate-400'}`} />
                    <Command.Input
                        value={query}
                        onValueChange={setQuery}
                        placeholder={semanticMode ? "Ask AI to find anything..." : "Type a command or search..."}
                        className="flex-1 h-12 bg-transparent outline-none text-lg text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 font-medium w-full border-none focus:ring-0"
                    />
                    <div className="flex gap-2 items-center">
                        <button
                            type="button"
                            onClick={() => setSemanticMode(!semanticMode)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 ${semanticMode
                                ? 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                                }`}
                            title="Toggle AI Smart Search"
                        >
                            <Sparkles size={12} className={semanticMode ? 'animate-pulse' : ''} />
                            AI
                        </button>
                        <kbd className="hidden sm:inline-flex h-6 select-none items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2 font-mono text-[10px] font-medium text-slate-500 dark:text-slate-400 pointer-events-none">
                            <span className="text-xs">
                                {navigator.platform.indexOf('Mac') > -1 ? '⌘' : 'Ctrl'}
                            </span>K
                        </kbd>
                    </div>
                </div>

                <Command.List className="max-h-[60vh] overflow-y-auto p-2 scroll-py-2 custom-scrollbar">
                    {loading && (
                        <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
                            <div className={`w-5 h-5 border-2 rounded-full animate-spin border-t-transparent ${semanticMode ? 'border-purple-500' : 'border-blue-500'}`} />
                            {semanticMode ? 'AI Searching...' : 'Searching...'}
                        </div>
                    )}

                    {!loading && results.length === 0 && semanticResults.length === 0 && query !== '' && (
                        <Command.Empty className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                            {semanticMode ? 'No AI matches found. Try described it differently.' : 'No results found.'}
                        </Command.Empty>
                    )}

                    {query === '' && (
                        <Command.Group heading="Navigation" className="text-xs font-semibold text-slate-400 dark:text-slate-500 mb-2 px-2 uppercase tracking-wider py-2">
                            <div className="space-y-1">
                                <CommandItem onSelect={() => runCommand(() => navigate('/'))}>
                                    <LayoutDashboard className="w-4 h-4 mr-3" />
                                    <span>Dashboard</span>
                                </CommandItem>

                                <CommandItem onSelect={() => runCommand(() => navigate('/inventory'))}>
                                    <Package className="w-4 h-4 mr-3" />
                                    <span>Inventory</span>
                                </CommandItem>

                                <CommandItem onSelect={() => runCommand(() => navigate('/orders'))}>
                                    <FileText className="w-4 h-4 mr-3" />
                                    <span>Orders</span>
                                </CommandItem>

                                <CommandItem onSelect={() => runCommand(() => navigate('/customers'))}>
                                    <Users className="w-4 h-4 mr-3" />
                                    <span>Customers</span>
                                </CommandItem>

                                <CommandItem onSelect={() => runCommand(() => navigate('/reports'))}>
                                    <BarChart2 className="w-4 h-4 mr-3" />
                                    <span>Reports</span>
                                </CommandItem>

                                <CommandItem onSelect={() => runCommand(() => navigate('/settings'))}>
                                    <Settings className="w-4 h-4 mr-3" />
                                    <span>Settings</span>
                                </CommandItem>
                            </div>
                        </Command.Group>
                    )}

                    {results.length > 0 && (
                        <Command.Group heading="Top Results" className="text-xs font-semibold text-slate-400 dark:text-slate-500 mt-2 px-2 uppercase tracking-wider py-2">
                            <div className="space-y-1">
                                {results.map((result) => (
                                    <CommandItem
                                        key={`${result.type}-${result.id}`}
                                        onSelect={() => runCommand(() => {
                                            if (result.type === 'product') {
                                                navigate(`/inventory/product/${result.id}`);
                                            } else {
                                                navigate(`/orders/${result.id}`);
                                            }
                                        })}
                                    >
                                        {result.type === 'product' ? (
                                            <Package className="w-4 h-4 mr-3 text-blue-500 dark:text-blue-400" />
                                        ) : (
                                            <FileText className="w-4 h-4 mr-3 text-emerald-500 dark:text-emerald-400" />
                                        )}
                                        <div className="flex flex-col">
                                            <span className="font-medium text-slate-900 dark:text-white">{result.title}</span>
                                            {result.subtitle && <span className="text-xs text-slate-500 dark:text-slate-400 font-normal">{result.subtitle}</span>}
                                        </div>
                                    </CommandItem>
                                ))}
                            </div>
                        </Command.Group>
                    )}

                    {semanticResults.length > 0 && (
                        <Command.Group heading="AI Smart Matches" className="text-xs font-semibold text-purple-600 dark:text-purple-400 mt-2 px-2 uppercase tracking-wider py-2">
                            <div className="space-y-1">
                                {semanticResults.map((result) => (
                                    <CommandItem
                                        key={`semantic-${result.id}`}
                                        onSelect={() => runCommand(() => navigate(`/inventory/product/${result.id}`))}
                                    >
                                        <Sparkles className="w-4 h-4 mr-3 text-purple-500 dark:text-purple-400" />
                                        <div className="flex flex-col flex-1">
                                            <span className="font-medium text-slate-900 dark:text-white">{result.title}</span>
                                            <span className="text-xs text-purple-600 dark:text-purple-300 font-normal">{result.subtitle}</span>
                                        </div>
                                    </CommandItem>
                                ))}
                            </div>
                        </Command.Group>
                    )}
                </Command.List>
            </div>
        </Command.Dialog>
    );
}

// Wrapper for Command.Item with consistent styling
function CommandItem({ children, onSelect }: { children: React.ReactNode, onSelect: () => void }) {
    return (
        <Command.Item
            onSelect={onSelect}
            className="flex items-center px-4 py-3.5 rounded-xl text-sm text-slate-700 dark:text-slate-300 cursor-pointer select-none aria-selected:bg-blue-50 dark:aria-selected:bg-blue-900/20 aria-selected:text-blue-700 dark:aria-selected:text-blue-400 data-[selected=true]:bg-blue-50 dark:data-[selected=true]:bg-blue-900/20 data-[selected=true]:text-blue-700 dark:data-[selected=true]:text-blue-400 transition-colors"
        >
            <>{children}</>
        </Command.Item>
    );
}
