import { useEffect, useState } from 'react';
import { Logger } from '../utils/logger';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { formatDate } from '../utils/format';
import { Loader2, RefreshCw, Search, Tag, TrendingUp, Filter, X, Eye } from 'lucide-react';
import { Pagination } from '../components/ui/Pagination';
import { OrderPreviewModal } from '../components/orders/OrderPreviewModal';
import { FraudIcon } from '../components/orders/FraudIcon';
import { printPicklist } from '../utils/printPicklist';

interface Order {
    id: number;
    status: string;
    total: number;
    currency: string;
    date_created: string;
    customer_id?: number;
    tags?: string[];
    billing: {
        first_name: string;
        last_name: string;
        email: string;
    };
    line_items: Array<{
        name: string;
        quantity: number;
    }>;
}

interface OrderAttribution {
    lastTouchSource: string;
}

export function OrdersPage() {
    const [searchParams, setSearchParams] = useSearchParams();

    // Initialize state from URL query params
    const tagsFromUrl = searchParams.get('tags');
    const searchFromUrl = searchParams.get('q');
    const statusFromUrl = searchParams.get('status');

    const [orders, setOrders] = useState<Order[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [searchQuery, setSearchQuery] = useState(searchFromUrl || '');

    // Picklist State
    const [picklistStatus, setPicklistStatus] = useState('processing');
    const [isGeneratingPicklist, setIsGeneratingPicklist] = useState(false);

    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [totalPages, setTotalPages] = useState(1);
    const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

    // Tag filtering - initialize from URL
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [tagColors, setTagColors] = useState<Record<string, string>>({});
    const [selectedTags, setSelectedTags] = useState<string[]>(
        tagsFromUrl ? tagsFromUrl.split(',').filter(Boolean) : []
    );
    const [showTagDropdown, setShowTagDropdown] = useState(false);
    const [attributions, setAttributions] = useState<Record<number, OrderAttribution | null>>({});

    // Status filter
    const [selectedStatus, setSelectedStatus] = useState(statusFromUrl || 'all');
    const statusOptions = [
        { value: 'all', label: 'All Statuses' },
        { value: 'pending', label: 'Pending' },
        { value: 'processing', label: 'Processing' },
        { value: 'on-hold', label: 'On Hold' },
        { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled' },
        { value: 'refunded', label: 'Refunded' },
        { value: 'failed', label: 'Failed' },
    ];

    const { token } = useAuth();
    const { currentAccount } = useAccount();

    // Sync filter state to URL
    useEffect(() => {
        const params: Record<string, string> = {};
        if (selectedTags.length > 0) params.tags = selectedTags.join(',');
        if (searchQuery) params.q = searchQuery;
        if (selectedStatus && selectedStatus !== 'all') params.status = selectedStatus;
        setSearchParams(params, { replace: true });
    }, [selectedTags, searchQuery, selectedStatus, setSearchParams]);

    useEffect(() => {
        fetchOrders();
    }, [currentAccount, token, searchQuery, page, limit, selectedTags, selectedStatus]);


    // Fetch available tags and colors
    useEffect(() => {
        if (!currentAccount || !token) return;
        fetch('/api/sync/orders/tags', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Account-ID': currentAccount.id
            }
        })
            .then(res => res.json())
            .then(data => {
                setAvailableTags(data.tags || []);
                setTagColors(data.tagColors || {});
            })
            .catch(() => {
                setAvailableTags([]);
                setTagColors({});
            });
    }, [currentAccount, token]);

    async function fetchOrders() {
        if (!currentAccount || !token) return;

        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            params.append('page', page.toString());
            params.append('limit', limit.toString());
            if (searchQuery) params.append('q', searchQuery);
            if (selectedTags.length > 0) params.append('tags', selectedTags.join(','));
            if (selectedStatus && selectedStatus !== 'all') params.append('status', selectedStatus);

            const res = await fetch(`/api/sync/orders/search?${params}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (!res.ok) throw new Error('Failed to fetch orders');

            const data = await res.json();
            setOrders(data.orders || data); // Handle both object and array response (fallback)
            if (data.totalPages) setTotalPages(data.totalPages);
            else setTotalPages(1); // Standard fallback
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setIsLoading(false);
        }
    }

    // Reset page on search, tag, or status change
    useEffect(() => {
        setPage(1);
    }, [searchQuery, selectedTags, selectedStatus]);

    // Fetch attributions for visible orders
    useEffect(() => {
        if (!orders.length || !token || !currentAccount) return;

        const fetchAttributions = async () => {
            const newAttributions: Record<number, OrderAttribution | null> = {};

            // Fetch attribution for each order (in parallel with a limit)
            const batchSize = 5;
            for (let i = 0; i < orders.length; i += batchSize) {
                const batch = orders.slice(i, i + batchSize);
                await Promise.all(batch.map(async (order) => {
                    if (attributions[order.id] !== undefined) {
                        newAttributions[order.id] = attributions[order.id];
                        return;
                    }
                    try {
                        const res = await fetch(`/api/orders/${order.id}/attribution`, {
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'X-Account-ID': currentAccount.id
                            }
                        });
                        if (res.ok) {
                            const data = await res.json();
                            newAttributions[order.id] = data.attribution ? {
                                lastTouchSource: data.attribution.lastTouchSource
                            } : null;
                        } else {
                            newAttributions[order.id] = null;
                        }
                    } catch {
                        newAttributions[order.id] = null;
                    }
                }));
            }

            setAttributions(prev => ({ ...prev, ...newAttributions }));
        };

        fetchAttributions();
    }, [orders, token, currentAccount]);

    async function handleSync() {
        if (!currentAccount || !token) return;
        setIsSyncing(true);
        try {
            const res = await fetch('/api/sync/manual', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify({
                    accountId: currentAccount.id,
                    types: ['orders']
                })
            });

            if (!res.ok) throw new Error('Sync failed');

            const result = await res.json();
            alert(`Sync started! Status: ${result.status}`);

            // Wait a bit before refreshing to allow some items to process? 
            // Better to just let the user refresh manually or poll, but for now just wait 2s
            setTimeout(fetchOrders, 2000);

        } catch (err) {
            Logger.error('An error occurred', { error: err });
            alert('Sync failed. Check backend logs.');
        } finally {
            setIsSyncing(false);
        }
    }

    async function handleGeneratePicklist() {
        if (!currentAccount || !token) return;
        setIsGeneratingPicklist(true);
        try {
            const params = new URLSearchParams({ status: picklistStatus, limit: '100' });
            const res = await fetch(`/api/inventory/picklist?${params}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.length === 0) {
                    alert('No items found for the selected status.');
                } else {
                    printPicklist(data);
                }
            } else {
                alert('Failed to generate picklist');
            }
        } catch (error) {
            Logger.error('An error occurred', { error: error });
            alert('Error generating picklist');
        } finally {
            setIsGeneratingPicklist(false);
        }
    }

    async function removeTag(orderId: number, tag: string) {
        if (!currentAccount || !token) return;
        try {
            const res = await fetch(`/api/orders/${orderId}/tags/${encodeURIComponent(tag)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (res.ok) {
                // Update the local order state to remove the tag immediately
                setOrders(prev => prev.map(order =>
                    order.id === orderId
                        ? { ...order, tags: (order.tags || []).filter(t => t !== tag) }
                        : order
                ));
            }
        } catch (err) {
            Logger.error('Failed to remove tag', { error: err });
        }
    }

    return (
        <div className="space-y-6">
            <OrderPreviewModal
                orderId={selectedOrderId}
                isOpen={!!selectedOrderId}
                onClose={() => setSelectedOrderId(null)}
            />

            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-gray-900">Orders</h1>
                    <span className="text-sm text-gray-500">Store: {currentAccount?.name}</span>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center w-full lg:w-auto">
                    {/* Picklist Toolbar */}
                    <div className="hidden md:flex items-center gap-2 bg-gray-50 p-1.5 rounded-lg border border-gray-200">
                        <select
                            value={picklistStatus}
                            onChange={(e) => setPicklistStatus(e.target.value)}
                            className="bg-transparent text-sm border-none focus:ring-0 text-gray-700 font-medium py-1"
                        >
                            <option value="processing">Processing</option>
                            <option value="pending">Pending</option>
                            <option value="on-hold">On Hold</option>
                        </select>
                        <button
                            onClick={handleGeneratePicklist}
                            disabled={isGeneratingPicklist}
                            className="bg-yellow-400 text-yellow-900 border border-yellow-500 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-yellow-500 hover:text-white transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                            {isGeneratingPicklist ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                            Picklist
                        </button>
                    </div>
                    <div className="relative flex-1 sm:flex-none">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search orders..."
                            className="w-full sm:w-auto pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* Tag Filter Dropdown */}
                    {availableTags.length > 0 && (
                        <div className="relative">
                            <button
                                onClick={() => setShowTagDropdown(!showTagDropdown)}
                                className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                <Tag size={16} />
                                <span className="hidden sm:inline">Tags</span>
                                {selectedTags.length > 0 && (
                                    <span className="bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                                        {selectedTags.length}
                                    </span>
                                )}
                            </button>
                            {showTagDropdown && (
                                <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-64 overflow-y-auto">
                                    <div className="p-2 border-b border-gray-100 flex justify-between items-center">
                                        <span className="text-xs font-semibold text-gray-500 uppercase">Filter by Tag</span>
                                        {selectedTags.length > 0 && (
                                            <button
                                                onClick={() => setSelectedTags([])}
                                                className="text-xs text-blue-600 hover:underline"
                                            >
                                                Clear all
                                            </button>
                                        )}
                                    </div>
                                    {availableTags.map(tag => (
                                        <label
                                            key={tag}
                                            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedTags.includes(tag)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedTags([...selectedTags, tag]);
                                                    } else {
                                                        setSelectedTags(selectedTags.filter(t => t !== tag));
                                                    }
                                                }}
                                                className="rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="text-sm text-gray-700">{tag}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Status Filter Dropdown */}
                    <div className="relative">
                        <select
                            value={selectedStatus}
                            onChange={(e) => setSelectedStatus(e.target.value)}
                            className="appearance-none bg-white border border-gray-300 text-gray-700 pl-9 pr-8 py-2 rounded-lg hover:bg-gray-50 transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                        >
                            {statusOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                        <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>

                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className="flex items-center justify-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={18} className={isSyncing ? "animate-spin" : ""} />
                        <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync Orders'}</span>
                        <span className="sm:hidden">{isSyncing ? 'Syncing' : 'Sync'}</span>
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[700px]">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold">
                                <th className="px-3 md:px-6 py-3 md:py-4">Order</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Date</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Status</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Customer</th>
                                <th className="px-6 py-4">Total</th>
                                <th className="px-6 py-4">Tags</th>
                                <th className="px-6 py-4">Attribution</th>
                                <th className="px-6 py-4">Items</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {isLoading ? (
                                <tr><td colSpan={8} className="p-12 text-center"><Loader2 className="animate-spin inline text-blue-600" /></td></tr>
                            ) : orders.length === 0 ? (
                                <tr><td colSpan={8} className="p-12 text-center text-gray-500">No orders found. Try syncing!</td></tr>
                            ) : (
                                orders.map((order) => (
                                    <tr
                                        key={order.id}
                                        className="hover:bg-gray-50 transition-colors"
                                    >
                                        <td className="px-3 md:px-6 py-3 md:py-4 font-medium outline-hidden">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => setSelectedOrderId(order.id)}
                                                    className="p-1 hover:bg-blue-100 rounded text-gray-400 hover:text-blue-600 transition-colors"
                                                    title="Quick preview"
                                                >
                                                    <Eye size={16} />
                                                </button>
                                                <FraudIcon orderId={order.id} />
                                                <Link
                                                    to={`/orders/${order.id}`}
                                                    className="text-blue-600 hover:text-blue-800 hover:underline"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    #{order.id}
                                                </Link>
                                            </div>
                                        </td>
                                        <td className="px-3 md:px-6 py-3 md:py-4 text-gray-600 text-sm">{formatDate(order.date_created)}</td>
                                        <td className="px-3 md:px-6 py-3 md:py-4">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                        ${order.status === 'completed' ? 'bg-green-100 text-green-800' :
                                                    order.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                                                        order.status === 'cancelled' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                                                {order.status}
                                            </span>
                                        </td>
                                        <td className="px-3 md:px-6 py-3 md:py-4 text-sm text-gray-900">
                                            {order.customer_id && order.customer_id > 0 ? (
                                                <Link
                                                    to={`/customers/${order.customer_id}`}
                                                    className="block hover:text-blue-600"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <div className="font-medium">{order.billing.first_name} {order.billing.last_name}</div>
                                                    <div className="text-gray-500 text-xs truncate max-w-[150px]">{order.billing.email}</div>
                                                </Link>
                                            ) : (
                                                <>
                                                    <div className="font-medium">{order.billing.first_name} {order.billing.last_name}</div>
                                                    <div className="text-gray-500 text-xs truncate max-w-[150px]">{order.billing.email}</div>
                                                </>
                                            )}
                                        </td>
                                        <td className="px-3 md:px-6 py-3 md:py-4 text-sm font-medium">
                                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency }).format(order.total)}
                                        </td>
                                        <td className="px-3 md:px-6 py-3 md:py-4">
                                            <div className="flex flex-wrap gap-1 max-w-[180px]">
                                                {(order.tags || []).slice(0, 3).map(tag => {
                                                    const bgColor = tagColors[tag] || '#E5E7EB';
                                                    return (
                                                        <span
                                                            key={tag}
                                                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm text-xs group"
                                                            style={{
                                                                backgroundColor: bgColor,
                                                                color: tagColors[tag] ? '#ffffff' : '#4B5563'
                                                            }}
                                                        >
                                                            {tag}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    removeTag(order.id, tag);
                                                                }}
                                                                className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                                                                title="Remove tag"
                                                            >
                                                                <X size={10} />
                                                            </button>
                                                        </span>
                                                    );
                                                })}
                                                {(order.tags || []).length > 3 && (
                                                    <span className="text-xs text-gray-400">+{order.tags!.length - 3}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 md:px-6 py-3 md:py-4">
                                            {attributions[order.id] ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                                                    <TrendingUp size={10} />
                                                    {attributions[order.id]!.lastTouchSource}
                                                </span>
                                            ) : attributions[order.id] === null ? (
                                                <span className="text-xs text-gray-400">-</span>
                                            ) : (
                                                <span className="text-xs text-gray-300">...</span>
                                            )}
                                        </td>
                                        <td className="px-3 md:px-6 py-3 md:py-4 text-sm text-gray-500">
                                            {order.line_items.length} items
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {!isLoading && orders.length > 0 && (
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
