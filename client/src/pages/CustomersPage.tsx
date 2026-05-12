import { useEffect, useState, useCallback } from 'react';
import { Logger } from '../utils/logger';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Search, Users, Mail, ShoppingBag, Calendar } from 'lucide-react';
import { Pagination } from '../components/ui/Pagination';
import { TableSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { RelativeTime } from '../components/ui/RelativeTime';
import { formatDate, formatCurrency } from '../utils/format';
import { subscribeToCrossTabEvents } from '../utils/productCrossTabEvents';

interface Customer {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    totalSpent: number;
    ordersCount: number;
    dateCreated: string;
    contactStatus?: 'UNVERIFIED' | 'SUBSCRIBED' | 'BOUNCED' | 'UNSUBSCRIBED' | 'SOFT_BOUNCED' | 'COMPLAINT';
}

function getContactStatusBadge(status: Customer['contactStatus']) {
    switch (status || 'SUBSCRIBED') {
        case 'UNVERIFIED':
            return { label: 'Unverified', className: 'bg-gray-100 text-gray-700 border-gray-200' };
        case 'SUBSCRIBED':
            return { label: 'Subscribed', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
        case 'BOUNCED':
            return { label: 'Bounced', className: 'bg-red-100 text-red-700 border-red-200' };
        case 'UNSUBSCRIBED':
            return { label: 'Unsubscribed', className: 'bg-amber-100 text-amber-700 border-amber-200' };
        case 'SOFT_BOUNCED':
            return { label: 'Soft Bounced', className: 'bg-orange-100 text-orange-700 border-orange-200' };
        case 'COMPLAINT':
            return { label: 'Complaint', className: 'bg-rose-100 text-rose-700 border-rose-200' };
        default:
            return { label: 'Subscribed', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
    }
}

export function CustomersPage() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [totalPages, setTotalPages] = useState(1);
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNVERIFIED' | 'SUBSCRIBED' | 'BOUNCED' | 'UNSUBSCRIBED' | 'SOFT_BOUNCED' | 'COMPLAINT'>('ALL');
    const [statusCounts, setStatusCounts] = useState<Record<'ALL' | 'UNVERIFIED' | 'SUBSCRIBED' | 'BOUNCED' | 'UNSUBSCRIBED' | 'SOFT_BOUNCED' | 'COMPLAINT', number>>({
        ALL: 0,
        UNVERIFIED: 0,
        SUBSCRIBED: 0,
        BOUNCED: 0,
        UNSUBSCRIBED: 0,
        SOFT_BOUNCED: 0,
        COMPLAINT: 0
    });

    const [debouncedQuery, setDebouncedQuery] = useState('');
    const currency = currentAccount?.currency || 'USD';

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchQuery);
            setPage(1);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const fetchCustomers = useCallback(async () => {
        if (!currentAccount || !token) return;

        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                q: debouncedQuery,
                status: statusFilter
            });

            const res = await fetch(`/api/customers?${params}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                setCustomers(data.customers);
                setTotalPages(data.totalPages);
                if (data.statusCounts) {
                    setStatusCounts(data.statusCounts);
                }
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token, page, limit, debouncedQuery, statusFilter]);

    useEffect(() => {
        fetchCustomers();
    }, [fetchCustomers]);

    useEffect(() => {
        const unsubscribe = subscribeToCrossTabEvents((event) => {
            if (event.resource !== 'customer' || event.accountId !== currentAccount?.id) {
                return;
            }

            void fetchCustomers();
        });

        return unsubscribe;
    }, [currentAccount?.id, fetchCustomers]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void fetchCustomers();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [fetchCustomers]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-gray-900">Customers</h1>
                    <p className="text-sm text-gray-500">View and manage your customer base</p>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                    <button
                        onClick={() => navigate('/customers/segments')}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
                    >
                        <Users size={16} />
                        Segments
                    </button>
                    <div className="relative flex-1 sm:flex-none">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search customers..."
                            className="w-full sm:w-64 pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <select
                        value={statusFilter}
                        onChange={(e) => {
                            setStatusFilter(e.target.value as typeof statusFilter);
                            setPage(1);
                        }}
                        className="w-full sm:w-44 px-3 py-2 border border-gray-300 rounded-lg outline-hidden focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                    >
                        <option value="ALL">All statuses</option>
                        <option value="SUBSCRIBED">Subscribed</option>
                        <option value="UNVERIFIED">Unverified</option>
                        <option value="UNSUBSCRIBED">Unsubscribed</option>
                        <option value="SOFT_BOUNCED">Soft Bounced</option>
                        <option value="BOUNCED">Bounced</option>
                        <option value="COMPLAINT">Complaint</option>
                    </select>
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                {[
                    ['ALL', 'All'],
                    ['SUBSCRIBED', 'Subscribed'],
                    ['UNVERIFIED', 'Unverified'],
                    ['UNSUBSCRIBED', 'Unsubscribed'],
                    ['SOFT_BOUNCED', 'Soft Bounced'],
                    ['BOUNCED', 'Bounced'],
                    ['COMPLAINT', 'Complaint']
                ].map(([value, label]) => (
                    <button
                        key={value}
                        onClick={() => {
                            setStatusFilter(value as typeof statusFilter);
                            setPage(1);
                        }}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${statusFilter === value
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        {label} {statusCounts[value as keyof typeof statusCounts] ?? 0}
                    </button>
                ))}
            </div>

            <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold">
                                <th className="px-3 md:px-6 py-3 md:py-4">Customer</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Contact</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Status</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Orders</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Total Spent</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Joined</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {isLoading ? (
                                <TableSkeleton rows={8} columns={6} showAvatar />
                            ) : customers.length === 0 ? (
                                <tr><td colSpan={6}>
                                    <EmptyState
                                        icon={<Users size={48} />}
                                        title={statusFilter === 'ALL' ? 'No customers found' : 'No customers in this status'}
                                        description={statusFilter === 'ALL'
                                            ? 'Customers will appear here once they place orders. Try syncing your store data.'
                                            : 'Try switching to another status filter or clear the search query.'}
                                    />
                                </td></tr>
                            ) : (
                                customers.map((customer) => {
                                    const statusBadge = getContactStatusBadge(customer.contactStatus);
                                    return <tr key={customer.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => {
                                        navigate(`/customers/${encodeURIComponent(customer.id)}`)
                                    }}>

                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3" title={customer.email}>
                                                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
                                                    {customer.firstName?.[0]}{customer.lastName?.[0]}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-gray-900">{customer.firstName} {customer.lastName}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            <div className="flex items-center gap-2">
                                                <Mail size={14} />
                                                {customer.email}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadge.className}`}>
                                                {statusBadge.label}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            <div
                                                className="flex items-center gap-2 cursor-default"
                                                title={`Total spent: ${formatCurrency(customer.totalSpent, currency)} across ${customer.ordersCount} order${customer.ordersCount !== 1 ? 's' : ''}`}
                                            >
                                                <ShoppingBag size={14} />
                                                {customer.ordersCount} order{customer.ordersCount !== 1 ? 's' : ''}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-medium text-gray-900">
                                            <span
                                                title={`${customer.ordersCount} order${customer.ordersCount !== 1 ? 's' : ''} · Avg ${formatCurrency(customer.ordersCount > 0 ? customer.totalSpent / customer.ordersCount : 0, currency)}`}
                                                className="cursor-default border-b border-dotted border-gray-300"
                                            >
                                                {formatCurrency(customer.totalSpent, currency)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            <div className="flex items-center gap-2">
                                                <Calendar size={14} />
                                                <div>
                                                    <div>{formatDate(customer.dateCreated)}</div>
                                                    <RelativeTime date={customer.dateCreated} />
                                                </div>
                                            </div>
                                        </td>
                                    </tr>;
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                {!isLoading && customers.length > 0 && (
                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        itemsPerPage={limit}
                        onItemsPerPageChange={(newLimit) => {
                            setLimit(newLimit);
                            setPage(1);
                        }}
                        allowItemsPerPage={true}
                    />
                )}
            </div>
        </div >
    );
}
