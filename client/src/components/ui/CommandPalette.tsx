
import React, { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { Search, Package, FileText, Settings, LayoutDashboard, Truck, Users, BarChart2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface SearchResult {
    id: string | number;
    title: string;
    subtitle?: string;
    type: 'product' | 'order';
}

export function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
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
            return;
        }

        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                // Determine what to search based on query type or just parallel search
                // For now, let's just search products and orders if query length > 2
                if (query.length < 2) return;

                const [productsRes, ordersRes] = await Promise.allSettled([
                    fetch(`/api/products?q=${encodeURIComponent(query)}&limit=5`, {
                        headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
                    }),
                    fetch(`/api/sync/orders/search?q=${encodeURIComponent(query)}&limit=5`, {
                        headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
                    })
                ]);

                const newResults: SearchResult[] = [];

                if (productsRes.status === 'fulfilled' && productsRes.value.ok) {
                    const data = await productsRes.value.json();
                    if (data.products) {
                        newResults.push(...data.products.map((p: any) => ({
                            id: p.id,
                            title: p.name,
                            subtitle: p.sku,
                            type: 'product'
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
                        type: 'order'
                    })));
                }

                setResults(newResults);
            } catch (err) {
                console.error("Search failed", err);
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [query, token, currentAccount]);

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
            className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/40 backdrop-blur-sm transition-all animate-in fade-in duration-200"
            onClick={(e) => {
                if (e.target === e.currentTarget) setOpen(false);
            }}
        >
            <div className="w-full max-w-2xl bg-white/90 backdrop-blur-md rounded-xl shadow-2xl border border-white/20 overflow-hidden animate-in zoom-in-95 duration-200 ring-1 ring-black/5">
                <div className="flex items-center border-b border-gray-200 px-4">
                    <Search className="w-5 h-5 text-gray-500 mr-2" />
                    <Command.Input
                        value={query}
                        onValueChange={setQuery}
                        placeholder="Type a command or search..."
                        className="flex-1 h-16 bg-transparent outline-none text-lg text-gray-900 placeholder:text-gray-400 font-medium w-full"
                    />
                    <div className="flex gap-1">
                        <kbd className="hidden sm:inline-flex h-6 select-none items-center gap-1 rounded border bg-gray-100 px-2 font-mono text-[10px] font-medium text-gray-500 pointer-events-none">
                            <span className="text-xs">
                                {navigator.platform.indexOf('Mac') > -1 ? '⌘' : 'Ctrl'}
                            </span>K
                        </kbd>
                    </div>
                </div>

                <Command.List className="max-h-[60vh] overflow-y-auto p-2 scroll-py-2">
                    {loading && (
                        <div className="py-6 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
                            <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                            Searching...
                        </div>
                    )}

                    {!loading && results.length === 0 && query !== '' && (
                        <Command.Empty className="py-6 text-center text-sm text-gray-500">
                            No results found.
                        </Command.Empty>
                    )}

                    {query === '' && (
                        <Command.Group heading="Navigation" className="text-xs font-semibold text-gray-500 mb-2 px-2">
                            <div className="space-y-1">
                                <CommandItem onSelect={() => runCommand(() => navigate('/'))}>
                                    <LayoutDashboard className="w-4 h-4 mr-2" />
                                    <span>Dashboard</span>
                                </CommandItem>

                                <CommandItem onSelect={() => runCommand(() => navigate('/inventory'))}>
                                    <Package className="w-4 h-4 mr-2" />
                                    <span>Inventory</span>
                                </CommandItem>

                                <CommandItem onSelect={() => runCommand(() => navigate('/orders'))}>
                                    <FileText className="w-4 h-4 mr-2" />
                                    <span>Orders</span>
                                </CommandItem>

                                <CommandItem onSelect={() => runCommand(() => navigate('/customers'))}>
                                    <Users className="w-4 h-4 mr-2" />
                                    <span>Customers</span>
                                </CommandItem>

                                <CommandItem onSelect={() => runCommand(() => navigate('/reports'))}>
                                    <BarChart2 className="w-4 h-4 mr-2" />
                                    <span>Reports</span>
                                </CommandItem>

                                <CommandItem onSelect={() => runCommand(() => navigate('/settings'))}>
                                    <Settings className="w-4 h-4 mr-2" />
                                    <span>Settings</span>
                                </CommandItem>
                            </div>
                        </Command.Group>
                    )}

                    {results.length > 0 && (
                        <Command.Group heading="Search Results" className="text-xs font-semibold text-gray-500 mt-2 px-2">
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
                                            <Package className="w-4 h-4 mr-2 text-blue-500" />
                                        ) : (
                                            <FileText className="w-4 h-4 mr-2 text-green-500" />
                                        )}
                                        <div className="flex flex-col">
                                            <span className="font-medium text-gray-900">{result.title}</span>
                                            {result.subtitle && <span className="text-xs text-gray-500 font-normal">{result.subtitle}</span>}
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
            className="flex items-center px-4 py-3 rounded-lg text-sm text-gray-700 cursor-pointer select-none aria-selected:bg-blue-50 aria-selected:text-blue-700 hover:bg-gray-100 transition-colors data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-700"
        >
            {children}
        </Command.Item>
    );
}
