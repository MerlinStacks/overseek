import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import {
    ChevronLeft,
    Search,
    Users,
    Mail,
    ShoppingBag,
    Calendar,
    ChevronRight,
    Loader2,
    User
} from 'lucide-react';
import { formatCurrency, formatDate } from '../../utils/format';
import { getInitials } from '../../utils/string';

/**
 * MobileCustomers - Mobile-optimized customer list with search
 * Displays customers with key metrics and links to details
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
        fetchCustomers(true);
    };

    const loadMore = () => {
        if (!loading && hasMore) {
            setPage(p => p + 1);
            fetchCustomers(false);
        }
    };

    // Currency formatting helper using centralized utility
    const formatAccountCurrency = (amount: number) =>
        formatCurrency(amount, currentAccount?.currency || 'USD');

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 active:bg-gray-200"
                    aria-label="Go back"
                >
                    <ChevronLeft size={24} />
                </button>
                <h1 className="text-xl font-bold text-gray-900">Customers</h1>
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex gap-2">
                <div className="flex-1 relative">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search customers..."
                        className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base"
                    />
                </div>
                <button
                    type="submit"
                    className="px-4 py-3 bg-indigo-600 text-white rounded-xl active:bg-indigo-700"
                >
                    <Search size={18} />
                </button>
            </form>

            {/* Stats Summary */}
            {!loading && customers.length > 0 && (
                <div className="flex gap-3">
                    <div className="flex-1 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
                        <div className="flex items-center gap-2 text-indigo-600 mb-1">
                            <Users size={16} />
                            <span className="text-xs font-medium">Total</span>
                        </div>
                        <p className="text-xl font-bold text-gray-900">{customers.length}</p>
                    </div>
                    <div className="flex-1 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-100">
                        <div className="flex items-center gap-2 text-green-600 mb-1">
                            <ShoppingBag size={16} />
                            <span className="text-xs font-medium">Total Spent</span>
                        </div>
                        <p className="text-xl font-bold text-gray-900">
                            {formatAccountCurrency(customers.reduce((sum, c) => sum + c.totalSpent, 0))}
                        </p>
                    </div>
                </div>
            )}

            {/* Customer List */}
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 size={32} className="animate-spin text-indigo-600" />
                </div>
            ) : customers.length === 0 ? (
                <div className="text-center py-12">
                    <Users size={48} className="mx-auto text-gray-300 mb-3" />
                    <p className="text-gray-500">No customers found</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {customers.map((customer) => (
                        <button
                            key={customer.id}
                            onClick={() => navigate(`/m/customers/${customer.id}`)}
                            className="w-full bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center gap-4 text-left active:bg-gray-50 transition-colors"
                        >
                            {/* Avatar */}
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                                {customer.avatarUrl ? (
                                    <img src={customer.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                                ) : (
                                    getInitials(`${customer.firstName} ${customer.lastName}`)
                                )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-900 truncate">
                                    {customer.firstName} {customer.lastName}
                                </p>
                                <p className="text-sm text-gray-500 truncate flex items-center gap-1">
                                    <Mail size={12} />
                                    {customer.email}
                                </p>
                                <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                                    <span className="flex items-center gap-1">
                                        <ShoppingBag size={10} />
                                        {customer.ordersCount} orders
                                    </span>
                                    <span className="font-medium text-green-600">
                                        {formatAccountCurrency(customer.totalSpent)}
                                    </span>
                                </div>
                            </div>

                            <ChevronRight size={20} className="text-gray-400 flex-shrink-0" />
                        </button>
                    ))}

                    {/* Load More */}
                    {hasMore && (
                        <button
                            onClick={loadMore}
                            className="w-full py-3 text-indigo-600 font-medium text-center"
                        >
                            Load More
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
