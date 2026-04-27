import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../utils/logger';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { Star, RefreshCw, Search, CheckCircle, ExternalLink, Link2, MessageSquare } from 'lucide-react';
import { Pagination } from '../components/ui/Pagination';
import { formatDate } from '../utils/format';
import { useNavigate } from 'react-router-dom';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { TableSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { RelativeTime } from '../components/ui/RelativeTime';
import { useToast } from '../context/ToastContext';

interface ReviewRow {
    id: string;
    productName?: string;
    reviewer?: string;
    reviewerEmail?: string;
    rating: number;
    content?: string;
    dateCreated: string;
    status: string;
    customer?: { id: string; firstName?: string; lastName?: string };
    order?: { number?: string };
}

export const ReviewsPage = () => {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();
    const [reviews, setReviews] = useState<ReviewRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isRematching, setIsRematching] = useState(false);

    // Filters & Pagination
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [totalPages, setTotalPages] = useState(1);
    // Debounce search query to prevent API calls on every keystroke
    const debouncedSearch = useDebouncedValue(searchQuery, 400);

    const fetchReviews = useCallback(async () => {
        if (!currentAccount || !token) return;

        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                accountId: currentAccount.id
            });

            if (debouncedSearch) params.append('search', debouncedSearch);
            if (statusFilter !== 'all') params.append('status', statusFilter);

            const res = await fetch(`/api/reviews?${params.toString()}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (!res.ok) throw new Error('Failed to fetch reviews');

            const data: unknown = await res.json();
            const payload = data as { reviews?: ReviewRow[]; pagination?: { pages?: number } };
            setReviews(payload.reviews || []);
            setTotalPages(payload.pagination?.pages || 1);

        } catch (error) {
            Logger.error('Failed to fetch reviews', { error: error });
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token, page, limit, debouncedSearch, statusFilter]);

    const handleSync = async () => {
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
                    types: ['reviews'],
                    incremental: true
                })
            });

            if (!res.ok) throw new Error('Sync failed');

            toast.success('Review sync started in background');
            setTimeout(fetchReviews, 2000);

        } catch (error) {
            Logger.error('Sync failed', { error: error });
            toast.error('Failed to start sync');
        } finally {
            setIsSyncing(false);
        }
    };

    const handleRematch = async () => {
        if (!currentAccount || !token) return;
        setIsRematching(true);
        try {
            const res = await fetch('/api/reviews/rematch-all', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify({})
            });

            if (!res.ok) throw new Error('Rematch failed');
            const result = await res.json();
            toast.success(`Rematch complete! ${result.matchedReviews}/${result.totalReviews} matched (${result.matchRate})`);
            fetchReviews();
        } catch (error) {
            Logger.error('Rematch failed', { error: error });
            toast.error('Failed to rematch reviews');
        } finally {
            setIsRematching(false);
        }
    };

    // Reset page when filters change
    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, statusFilter]);

    // Fetch on changes
    useEffect(() => {
        fetchReviews();
    }, [currentAccount, token, page, limit, debouncedSearch, statusFilter, fetchReviews]);

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Reviews</h1>
                    <p className="text-sm text-gray-500">Manage and view customer reviews</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search reviews..."
                            className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <select
                        className="border border-gray-300 rounded-lg px-3 py-2 outline-hidden focus:ring-2 focus:ring-blue-500 bg-white"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="all">All Status</option>
                        <option value="approved">Approved</option>
                        <option value="hold">Pending</option>
                        <option value="spam">Spam</option>
                        <option value="trash">Trash</option>
                    </select>

                    <button
                        onClick={handleRematch}
                        disabled={isRematching || isSyncing}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                        title="Re-link reviews to their matching orders"
                    >
                        <Link2 size={18} className={isRematching ? "animate-pulse" : ""} />
                        {isRematching ? 'Matching...' : 'Link to Orders'}
                    </button>

                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={18} className={isSyncing ? "animate-spin" : ""} />
                        {isSyncing ? 'Syncing...' : 'Sync'}
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reviewer</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rating</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Review</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {isLoading ? (
                            <TableSkeleton rows={8} columns={6} />
                        ) : reviews.length === 0 ? (
                            <tr><td colSpan={6}>
                                <EmptyState
                                    icon={<MessageSquare size={48} />}
                                    title="No reviews found"
                                    description="Reviews will appear here after syncing. Try adjusting your filters or syncing your store."
                                    action={{ label: 'Sync Reviews', onClick: handleSync, icon: <RefreshCw size={16} /> }}
                                />
                            </td></tr>
                        ) : (
                            reviews.map((review) => (
                                <tr key={review.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">{review.productName || 'Unknown Product'}</td>
                                    <td className="px-6 py-4 text-sm text-gray-900">
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">
                                                    {review.customer ? (
                                                        <button
                                                            onClick={() => review.customer?.id && navigate(`/customers/${review.customer.id}`)}
                                                            className="text-blue-600 hover:underline flex items-center gap-1"
                                                        >
                                                            {review.customer.firstName ? `${review.customer.firstName} ${review.customer.lastName || ''}` : review.reviewer}
                                                            <ExternalLink size={12} />
                                                        </button>
                                                    ) : (
                                                        review.reviewer
                                                    )}
                                                </span>
                                                {review.order && (
                                                    <div className="group relative">
                                                        <CheckCircle size={16} className="text-green-500 cursor-help" />
                                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 bg-gray-800 text-white text-xs rounded-sm p-2 text-center whitespace-normal z-10 shadow-lg">
                                                            Verified Owner via Order #{review.order.number}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <span className="text-xs text-gray-500">{review.reviewerEmail || ''}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-yellow-400">
                                        <div className="flex items-center cursor-default" title={review.content ? `"${review.content.slice(0, 200)}${review.content.length > 200 ? '...' : ''}"` : 'No review text'}>
                                            {Array.from({ length: 5 }).map((_, i) => (
                                                <Star key={i} size={16} fill={i < review.rating ? "currentColor" : "none"} strokeWidth={1} />
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate" title={review.content}>
                                        {review.content}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        <div>{formatDate(review.dateCreated)}</div>
                                        <RelativeTime date={review.dateCreated} />
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                                            ${review.status === 'approved' ? 'bg-green-100 text-green-800' :
                                                review.status === 'hold' ? 'bg-yellow-100 text-yellow-800' :
                                                    'bg-gray-100 text-gray-800'}`}>
                                            {review.status}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {!isLoading && reviews.length > 0 && (
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
    );
};
