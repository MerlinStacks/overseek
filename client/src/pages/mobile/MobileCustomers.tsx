import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useHaptic } from '../../hooks/useHaptic';
import {
    ChevronLeft,
    Search,
    Users,
    Mail,
    ShoppingBag,
    ChevronRight,
    Loader2
} from 'lucide-react';
import { formatCurrency } from '../../utils/format';
import { getInitials } from '../../utils/string';
import { ListSkeleton } from '../../components/mobile/MobileSkeleton';

/**
 * MobileCustomers - Premium dark-mode customer list for PWA.
 * Features search and displays customer metrics.
 */

interface CustomerApiResponse {
    id: string;
    firstName?: string;
    first_name?: string;
    lastName?: string;
    last_name?: string;
    email?: string;
    totalSpent?: number;
    total_spent?: number;
    ordersCount?: number;
    orders_count?: number;
    dateCreated?: string;
    date_created?: string;
    createdAt?: string;
    avatarUrl?: string;
}

interface Customer {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    totalSpent: number;
    ordersCount: number;
    dateCreated: string;
    avatarUrl?: string;
}

export function MobileCustomers() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { triggerHaptic } = useHaptic();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);

    const fetchCustomers = useCallback(async (reset = false) => {
        if (!currentAccount || !token) return;

        try {
            if (reset) setLoading(true);

            const params = new URLSearchParams();
            params.append('page', reset ? '1' : page.toString());
            params.append('limit', '20');
            if (searchQuery) params.append('q', searchQuery);

            const res = await fetch(`/api/customers?${params}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (!res.ok) throw new Error('Failed to fetch');

            const data = await res.json();
            const newCustomers = (data.customers || data || []).map((c: CustomerApiResponse) => ({
                id: c.id,
                firstName: c.firstName || c.first_name || '',
                lastName: c.lastName || c.last_name || '',
                email: c.email || '',
                totalSpent: Number(c.totalSpent || c.total_spent) || 0,
                ordersCount: c.ordersCount || c.orders_count || 0,
                dateCreated: c.dateCreated || c.date_created || c.createdAt || '',
                avatarUrl: c.avatarUrl
            }));

            if (reset) {
                setCustomers(newCustomers);
                setPage(1);
            } else {
                setCustomers(prev => [...prev, ...newCustomers]);
            }
            setHasMore(newCustomers.length === 20);
        } catch (error) {
            Logger.error('[MobileCustomers] Error:', { error: error });
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token, searchQuery, page]);

    useEffect(() => {
        fetchCustomers(true);
        const handleRefresh = () => fetchCustomers(true);
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [currentAccount, token]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        triggerHaptic();
        fetchCustomers(true);
    };

    const loadMore = () => {
        if (!loading && hasMore) {
            setPage(p => p + 1);
            fetchCustomers(false);
        }
    };

    const formatAccountCurrency = (amount: number) =>
        formatCurrency(amount, currentAccount?.currency || 'USD');

    if (loading && customers.length === 0) {
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-slate-800/50" />
                    <div className="h-6 w-24 bg-slate-800/50 rounded-lg" />
                </div>
                <ListSkeleton count={6} />
            </div>
        );
    }

    return (
        <div className="space-y-4 animate-fade-slide-up">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => {
                        triggerHaptic();
                        navigate(-1);
                    }}
                    className="w-10 h-10 flex items-center justify-center rounded-2xl bg-slate-700/40 border border-white/10 active:scale-95 transition-transform"
                    aria-label="Go back"
                >
                    <ChevronLeft size={22} className="text-slate-300" />
                </button>
                <h1 className="text-xl font-bold text-white">Customers</h1>
                <span className="ml-auto text-sm text-slate-400 bg-slate-800/50 px-3 py-1 rounded-full">
                    {customers.length}
                </span>
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex gap-2">
                <div className="flex-1 relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-slate-700/50">
                        <Search size={14} className="text-slate-400" />
                    </div>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search customers..."
                        className="w-full pl-14 pr-4 py-3.5 pwa-card text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                    />
                </div>
                <button
                    type="submit"
                    className="px-4 py-3.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-2xl active:scale-95 transition-transform shadow-lg shadow-indigo-500/25"
                >
                    <Search size={18} />
                </button>
            </form>

            {/* Stats Summary */}
            {customers.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                    <div className="pwa-card p-4">
                        <div className="flex items-center gap-2 text-indigo-400 mb-1">
                            <Users size={16} />
                            <span className="text-xs font-medium">Total</span>
                        </div>
                        <p className="text-xl font-bold text-white">{customers.length}</p>
                    </div>
                    <div className="pwa-card p-4">
                        <div className="flex items-center gap-2 text-emerald-400 mb-1">
                            <ShoppingBag size={16} />
                            <span className="text-xs font-medium">Total Spent</span>
                        </div>
                        <p className="text-xl font-bold text-white">
                            {formatAccountCurrency(customers.reduce((sum, c) => sum + c.totalSpent, 0))}
                        </p>
                    </div>
                </div>
            )}

            {/* Customer List */}
            {customers.length === 0 ? (
                <div className="text-center py-16">
                    <div className="w-20 h-20 mx-auto mb-4 pwa-card flex items-center justify-center">
                        <Users className="text-slate-500" size={36} />
                    </div>
                    <p className="text-white font-semibold mb-1">No customers found</p>
                    <p className="text-slate-400 text-sm">Customers will appear here</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {customers.map((customer, index) => (
                        <button
                            key={customer.id}
                            onClick={() => {
                                triggerHaptic();
                                navigate(`/m/customers/${customer.id}`);
                            }}
                            className="w-full pwa-card p-4 flex items-center gap-4 text-left active:bg-slate-700/50 transition-all animate-fade-slide-up"
                            style={{ animationDelay: `${index * 15}ms` }}
                        >
                            {/* Avatar */}
                            {customer.avatarUrl ? (
                                <img
                                    src={customer.avatarUrl}
                                    alt=""
                                    className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                                />
                            ) : (
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0 shadow-lg shadow-indigo-500/25">
                                    {getInitials(`${customer.firstName} ${customer.lastName}`)}
                                </div>
                            )}

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-white truncate">
                                    {customer.firstName} {customer.lastName}
                                </p>
                                <p className="text-sm text-slate-400 truncate flex items-center gap-1.5">
                                    <Mail size={12} />
                                    {customer.email}
                                </p>
                                <div className="flex items-center gap-3 mt-1.5 text-xs">
                                    <span className="flex items-center gap-1 text-slate-500">
                                        <ShoppingBag size={10} />
                                        {customer.ordersCount} orders
                                    </span>
                                    <span className="font-medium text-emerald-400">
                                        {formatAccountCurrency(customer.totalSpent)}
                                    </span>
                                </div>
                            </div>

                            <ChevronRight size={18} className="text-slate-500 flex-shrink-0" />
                        </button>
                    ))}

                    {/* Load More */}
                    {hasMore && (
                        <button
                            onClick={loadMore}
                            disabled={loading}
                            className="w-full py-4 text-indigo-400 font-semibold pwa-card active:bg-slate-700/50 transition-all flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Loading...
                                </>
                            ) : (
                                'Load More'
                            )}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
