import { useState, useEffect, useCallback, useMemo } from 'react';
import { Logger } from '../utils/logger';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { Star, RefreshCw, Search, CheckCircle, ExternalLink, Link2, MessageSquare, Reply, Paperclip, Video, Sparkles, Loader2 } from 'lucide-react';
import { Pagination } from '../components/ui/Pagination';
import { formatDate } from '../utils/format';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { TableSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { RelativeTime } from '../components/ui/RelativeTime';
import { useToast } from '../context/ToastContext';
import { getSafeHref } from '../utils/url';
import { formatReviewStatusLabel, formatReviewText } from '../utils/reviews';

interface ReviewRow {
    id: string;
    productName?: string;
    reviewer?: string;
    reviewerEmail?: string;
    rating: number;
    content?: string;
    dateCreated: string;
    status: string;
    productUrl?: string | null;
    productImage?: string | null;
    customer?: { id: string; firstName?: string; lastName?: string };
    order?: { wooId?: number; number?: string };
    media?: ReviewMedia[];
    replies?: ReviewReply[];
}

interface ReviewMedia {
    id?: number;
    url?: string;
    type?: string;
    filename?: string;
}

interface ReviewReply {
    id?: number;
    author?: string;
    content?: string;
    date?: string;
}

interface StatusCounts {
    total: number;
    counts: Record<string, number>;
}

const REVIEW_STATUSES = [
    { value: 'all', label: 'All' },
    { value: 'approved', label: 'Published' },
    { value: 'hold', label: 'Pending' },
    { value: 'spam', label: 'Spam' },
    { value: 'trash', label: 'Trash' },
];

const isImageMedia = (media: ReviewMedia) => media.type?.startsWith('image/');
const isVideoMedia = (media: ReviewMedia) => media.type?.startsWith('video/');

export const ReviewsPage = () => {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const toast = useToast();
    const [reviews, setReviews] = useState<ReviewRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isRematching, setIsRematching] = useState(false);
    const [actionReviewId, setActionReviewId] = useState<string | null>(null);
    const [replyReview, setReplyReview] = useState<ReviewRow | null>(null);
    const [replyText, setReplyText] = useState('');
    const [isGeneratingReply, setIsGeneratingReply] = useState(false);
    const [editReview, setEditReview] = useState<ReviewRow | null>(null);
    const [editContent, setEditContent] = useState('');
    const [editRating, setEditRating] = useState(5);
    const [editStatus, setEditStatus] = useState('hold');
    const [mediaViewer, setMediaViewer] = useState<ReviewMedia | null>(null);
    const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
    const [expandedReviewIds, setExpandedReviewIds] = useState<string[]>([]);
    const [bulkStatus, setBulkStatus] = useState('approved');
    const [statusCounts, setStatusCounts] = useState<StatusCounts>({ total: 0, counts: {} });

    // Filters & Pagination
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all');
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
            const payload = data as { reviews?: ReviewRow[]; pagination?: { pages?: number }; statusCounts?: StatusCounts };
            setReviews(payload.reviews || []);
            setTotalPages(payload.pagination?.pages || 1);
            setStatusCounts(payload.statusCounts || { total: 0, counts: {} });

        } catch (error) {
            Logger.error('Failed to fetch reviews', { error: error });
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token, page, limit, debouncedSearch, statusFilter]);

    const statusTabs = useMemo(() => REVIEW_STATUSES.map((status) => ({
        ...status,
        count: status.value === 'all' ? statusCounts.total : statusCounts.counts[status.value] || 0,
    })), [statusCounts]);

    const selectedReviewSet = useMemo(() => new Set(selectedReviewIds), [selectedReviewIds]);
    const expandedReviewSet = useMemo(() => new Set(expandedReviewIds), [expandedReviewIds]);
    const allVisibleSelected = reviews.length > 0 && reviews.every((review) => selectedReviewSet.has(review.id));

    const handleStatusFilterChange = (status: string) => {
        setStatusFilter(status);
        setPage(1);
        setSelectedReviewIds([]);
        const nextParams = new URLSearchParams(searchParams);
        if (status === 'all') nextParams.delete('status');
        else nextParams.set('status', status);
        setSearchParams(nextParams, { replace: true });
    };

    const toggleReviewSelection = (reviewId: string) => {
        setSelectedReviewIds((current) => current.includes(reviewId)
            ? current.filter((id) => id !== reviewId)
            : [...current, reviewId]);
    };

    const toggleReviewExpanded = (reviewId: string) => {
        setExpandedReviewIds((current) => current.includes(reviewId)
            ? current.filter((id) => id !== reviewId)
            : [...current, reviewId]);
    };

    const toggleAllVisibleReviews = () => {
        setSelectedReviewIds((current) => {
            const currentSet = new Set(current);
            if (allVisibleSelected) {
                return current.filter((id) => !reviews.some((review) => review.id === id));
            }
            reviews.forEach((review) => currentSet.add(review.id));
            return Array.from(currentSet);
        });
    };

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

    const handleModerate = async (reviewId: string, status: string) => {
        if (!currentAccount || !token) return;
        setActionReviewId(reviewId);
        try {
            const res = await fetch(`/api/reviews/${reviewId}/moderate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify({ status })
            });

            const result = await res.json().catch(() => ({})) as { error?: string };
            if (!res.ok) throw new Error(result.error || 'Moderation failed');
            toast.success(`Review marked ${formatReviewStatusLabel(status).toLowerCase()}`);
            fetchReviews();
        } catch (error) {
            Logger.error('Review moderation failed', { error });
            toast.error(error instanceof Error ? error.message : 'Failed to update review');
        } finally {
            setActionReviewId(null);
        }
    };

    const handleBulkModerate = async () => {
        if (!currentAccount || !token || selectedReviewIds.length === 0) return;
        setActionReviewId('bulk');
        try {
            const res = await fetch('/api/reviews/bulk-moderate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify({ ids: selectedReviewIds, status: bulkStatus })
            });

            const result = await res.json().catch(() => ({})) as { updated?: number; failed?: number; error?: string };
            if (!res.ok) throw new Error(result.error || 'Bulk moderation failed');
            toast.success(`${result.updated || 0} review${result.updated === 1 ? '' : 's'} marked ${formatReviewStatusLabel(bulkStatus).toLowerCase()}${result.failed ? `, ${result.failed} failed` : ''}`);
            setSelectedReviewIds([]);
            fetchReviews();
        } catch (error) {
            Logger.error('Bulk review moderation failed', { error });
            toast.error(error instanceof Error ? error.message : 'Failed to update reviews');
        } finally {
            setActionReviewId(null);
        }
    };

    const openReplyModal = (review: ReviewRow) => {
        setReplyReview(review);
        setReplyText('');
    };

    const closeReplyModal = () => {
        if (actionReviewId || isGeneratingReply) return;
        setReplyReview(null);
        setReplyText('');
    };

    const handleGenerateAIReply = async () => {
        if (!currentAccount || !token || !replyReview || isGeneratingReply) return;

        setIsGeneratingReply(true);
        try {
            const res = await fetch(`/api/reviews/${replyReview.id}/ai-reply`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify({ currentDraft: replyText })
            });

            const data = await res.json().catch(() => ({})) as { reply?: string; error?: string };
            if (!res.ok) throw new Error(data.error || 'AI reply generation failed');

            setReplyText(data.reply || '');
            toast.success('AI reply drafted');
        } catch (error) {
            Logger.error('Review AI reply generation failed', { error });
            toast.error(error instanceof Error ? error.message : 'Failed to generate AI reply');
        } finally {
            setIsGeneratingReply(false);
        }
    };

    const openEditModal = (review: ReviewRow) => {
        setEditReview(review);
        setEditContent(review.content || '');
        setEditRating(review.rating || 5);
        setEditStatus(review.status || 'hold');
    };

    const closeEditModal = () => {
        if (actionReviewId) return;
        setEditReview(null);
        setEditContent('');
        setEditRating(5);
        setEditStatus('hold');
    };

    const handleReply = async () => {
        if (!currentAccount || !token) return;
        if (!replyReview || !replyText.trim()) return;

        setActionReviewId(replyReview.id);
        try {
            const res = await fetch(`/api/reviews/${replyReview.id}/reply`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify({ reply: replyText.trim() })
            });

            if (!res.ok) throw new Error('Reply failed');
            toast.success('Reply posted');
            setReplyReview(null);
            setReplyText('');
            fetchReviews();
        } catch (error) {
            Logger.error('Review reply failed', { error });
            toast.error('Failed to reply to review');
        } finally {
            setActionReviewId(null);
        }
    };

    const handleEditReview = async () => {
        if (!currentAccount || !token || !editReview) return;
        const content = editContent.trim();
        if (!content) return;

        setActionReviewId(editReview.id);
        try {
            const res = await fetch(`/api/reviews/${editReview.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify({ content, rating: editRating, status: editStatus })
            });

            if (!res.ok) throw new Error('Review update failed');
            toast.success('Review updated');
            setEditReview(null);
            setEditContent('');
            fetchReviews();
        } catch (error) {
            Logger.error('Review update failed', { error });
            toast.error('Failed to update review');
        } finally {
            setActionReviewId(null);
        }
    };

    // Reset page when filters change
    useEffect(() => {
        setPage(1);
        setSelectedReviewIds([]);
    }, [debouncedSearch, statusFilter]);

    useEffect(() => {
        const status = searchParams.get('status') || 'all';
        if (status !== statusFilter) setStatusFilter(status);
    }, [searchParams, statusFilter]);

    // Fetch on changes
    useEffect(() => {
        fetchReviews();
    }, [currentAccount, token, page, limit, debouncedSearch, statusFilter, fetchReviews]);

    useEffect(() => {
        const hasOpenModal = replyReview || editReview || mediaViewer;
        if (!hasOpenModal) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || actionReviewId) return;
            setReplyReview(null);
            setEditReview(null);
            setMediaViewer(null);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [actionReviewId, editReview, isGeneratingReply, mediaViewer, replyReview]);

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

            <div className="bg-white/60 backdrop-blur-sm rounded-xl border border-gray-200/60 shadow-sm overflow-hidden">
                <div className="flex items-center gap-1 p-1.5 overflow-x-auto" role="tablist" aria-label="Review status filters">
                    {statusTabs.map((status) => {
                        const isActive = statusFilter === status.value;
                        return (
                            <button
                                key={status.value}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                onClick={() => handleStatusFilterChange(status.value)}
                                className={`group relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 whitespace-nowrap ${isActive
                                    ? status.value === 'hold'
                                        ? 'bg-amber-500 text-white shadow-md shadow-amber-200/50'
                                        : status.value === 'approved'
                                            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200/50'
                                            : status.value === 'trash'
                                                ? 'bg-red-500 text-white shadow-md shadow-red-200/50'
                                                : status.value === 'spam'
                                                    ? 'bg-slate-600 text-white shadow-md shadow-slate-200/50'
                                                    : 'bg-slate-800 text-white shadow-md'
                                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
                            >
                                <span>{status.label}</span>
                                <span className={isActive ? 'bg-white/25 text-white/90 text-xs px-1.5 py-0.5 rounded-md font-medium tabular-nums' : 'bg-gray-200/70 text-gray-500 text-xs px-1.5 py-0.5 rounded-md font-medium tabular-nums group-hover:bg-gray-300/70'}>
                                    {status.count}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {selectedReviewIds.length > 0 && (
                <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="font-medium text-blue-900">{selectedReviewIds.length} selected</div>
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={bulkStatus}
                            onChange={(event) => setBulkStatus(event.target.value)}
                            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm outline-hidden focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="approved">Publish</option>
                            <option value="hold">Move to pending</option>
                            <option value="spam">Mark spam</option>
                            <option value="trash">Move to trash</option>
                        </select>
                        <button
                            type="button"
                            onClick={handleBulkModerate}
                            disabled={actionReviewId === 'bulk'}
                            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            {actionReviewId === 'bulk' ? 'Updating...' : 'Apply'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setSelectedReviewIds([])}
                            disabled={actionReviewId === 'bulk'}
                            className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                <input
                                    type="checkbox"
                                    checked={allVisibleSelected}
                                    onChange={toggleAllVisibleReviews}
                                    aria-label="Select all visible reviews"
                                    className="rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reviewer</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rating</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Review</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {isLoading ? (
                            <TableSkeleton rows={8} columns={8} />
                        ) : reviews.length === 0 ? (
                            <tr><td colSpan={8}>
                                <EmptyState
                                    icon={<MessageSquare size={48} />}
                                    title="No reviews found"
                                    description="Reviews will appear here after syncing. Try adjusting your filters or syncing your store."
                                    action={{ label: 'Sync Reviews', onClick: handleSync, icon: <RefreshCw size={16} /> }}
                                />
                            </td></tr>
                        ) : (
                            reviews.map((review) => {
                                const reviewText = formatReviewText(review.content);
                                const isExpanded = expandedReviewSet.has(review.id);
                                const canExpand = reviewText.length > 120 || reviewText.includes('\n');

                                return (
                                <tr key={review.id} className="hover:bg-gray-50 transition-colors align-top">
                                    <td className="px-6 py-4">
                                        <input
                                            type="checkbox"
                                            checked={selectedReviewSet.has(review.id)}
                                            onChange={() => toggleReviewSelection(review.id)}
                                            aria-label={`Select review by ${review.reviewer || 'customer'}`}
                                            className="rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                                        <div className="flex items-center gap-3">
                                            {review.productImage ? (
                                                <img src={review.productImage} alt="" className="h-10 w-10 rounded-md object-cover ring-1 ring-gray-200" />
                                            ) : (
                                                <div className="h-10 w-10 rounded-md bg-gray-100 ring-1 ring-gray-200" />
                                            )}
                                            <div className="min-w-0">
                                                <div className="truncate max-w-[220px]">{review.productName || 'Unknown Product'}</div>
                                                {review.productUrl && (
                                                    <a href={getSafeHref(review.productUrl)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-normal text-blue-600 hover:underline">
                                                        View product <ExternalLink size={11} />
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    </td>
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
                                                        <button
                                                            type="button"
                                                            onClick={() => review.order?.wooId && navigate(`/orders/${review.order.wooId}`)}
                                                            className="text-green-500 hover:text-green-700"
                                                            title={`Open order #${review.order.number || review.order.wooId || ''}`}
                                                        >
                                                            <CheckCircle size={16} />
                                                        </button>
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
                                        <div className="flex items-center cursor-default" title={reviewText ? `"${reviewText.slice(0, 200)}${reviewText.length > 200 ? '...' : ''}"` : 'No review text'}>
                                            {Array.from({ length: 5 }).map((_, i) => (
                                                <Star key={i} size={16} fill={i < review.rating ? "currentColor" : "none"} strokeWidth={1} />
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500 max-w-sm" title={reviewText}>
                                        <div className="space-y-2">
                                            {reviewText ? (
                                                <div>
                                                    <p className={isExpanded ? 'whitespace-pre-wrap text-gray-700' : 'line-clamp-2 text-gray-700'}>
                                                        {reviewText}
                                                    </p>
                                                    {canExpand && (
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleReviewExpanded(review.id)}
                                                            className="mt-1 text-xs font-medium text-blue-600 hover:underline"
                                                        >
                                                            {isExpanded ? 'Show less' : 'Read more'}
                                                        </button>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-gray-400">No review text</span>
                                            )}
                                            {review.media && review.media.length > 0 && (
                                                <div className="flex flex-wrap gap-2">
                                                    {review.media.map((media, index) => (
                                                        <button
                                                            type="button"
                                                            key={media.id || `${media.url}-${index}`}
                                                            onClick={() => setMediaViewer(media)}
                                                            className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-gray-50 text-gray-500 hover:border-blue-300 hover:text-blue-600"
                                                            title={media.filename || media.url || 'Review media'}
                                                        >
                                                            {media.url && isImageMedia(media) ? (
                                                                <img src={media.url} alt={media.filename || 'Review media'} className="h-full w-full object-cover" />
                                                            ) : isVideoMedia(media) ? (
                                                                <Video size={16} />
                                                            ) : (
                                                                <Paperclip size={16} />
                                                            )}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {review.replies && review.replies.length > 0 && (
                                                <div className="space-y-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
                                                    <div className="font-semibold">{review.replies.length === 1 ? 'Reply' : `${review.replies.length} replies`}</div>
                                                    {review.replies.map((reply, index) => (
                                                        <div key={reply.id || `${reply.date || 'reply'}-${index}`} className="border-t border-blue-100 pt-2 first:border-t-0 first:pt-0">
                                                            <div className="font-medium">{reply.author || 'Store'}</div>
                                                            <div className="line-clamp-2">{formatReviewText(reply.content)}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        <div>{formatDate(review.dateCreated)}</div>
                                        <RelativeTime date={review.dateCreated} />
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                                            ${review.status === 'approved' ? 'bg-green-100 text-green-800' :
                                                review.status === 'hold' ? 'bg-yellow-100 text-yellow-800' :
                                                    review.status === 'spam' ? 'bg-gray-100 text-gray-800' :
                                                        review.status === 'trash' ? 'bg-red-100 text-red-800' :
                                                            'bg-gray-100 text-gray-800'}`}>
                                            {formatReviewStatusLabel(review.status)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm">
                                        <div className="flex min-w-[170px] flex-col gap-2">
                                            <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => openReplyModal(review)}
                                                disabled={actionReviewId === review.id}
                                                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                <Reply size={13} /> Reply
                                            </button>
                                            <button
                                                onClick={() => openEditModal(review)}
                                                disabled={actionReviewId === review.id}
                                                className="rounded-md border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                Edit
                                            </button>
                                            </div>
                                            <label className="sr-only" htmlFor={`review-status-${review.id}`}>Change review status</label>
                                            <select
                                                id={`review-status-${review.id}`}
                                                value={review.status}
                                                disabled={actionReviewId === review.id}
                                                onChange={(event) => {
                                                    const nextStatus = event.target.value;
                                                    if (nextStatus !== review.status) handleModerate(review.id, nextStatus);
                                                }}
                                                className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 outline-hidden hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                                            >
                                                <option value="approved">Published</option>
                                                <option value="hold">Pending</option>
                                                <option value="spam">Spam</option>
                                                <option value="trash">Trash</option>
                                            </select>
                                        </div>
                                    </td>
                                </tr>
                                );
                            })
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

            {replyReview && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="presentation">
                    <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" role="dialog" aria-modal="true" aria-labelledby="review-reply-title">
                        <div className="border-b border-gray-200 px-6 py-4">
                            <h2 id="review-reply-title" className="text-lg font-semibold text-gray-900">Reply to review</h2>
                            <p className="mt-1 text-sm text-gray-500">
                                {replyReview.reviewer || 'Customer'} on {replyReview.productName || 'Unknown Product'}
                            </p>
                        </div>
                        <div className="space-y-4 px-6 py-5">
                            <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                                <div className="mb-1 flex items-center gap-1 text-yellow-400">
                                    {Array.from({ length: 5 }).map((_, i) => (
                                        <Star key={i} size={14} fill={i < replyReview.rating ? "currentColor" : "none"} strokeWidth={1} />
                                    ))}
                                </div>
                                <p className="line-clamp-4 whitespace-pre-wrap">{formatReviewText(replyReview.content) || 'No review text'}</p>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <label className="block text-sm font-medium text-gray-700" htmlFor="review-reply-text">
                                    Your reply
                                </label>
                                <button
                                    type="button"
                                    onClick={handleGenerateAIReply}
                                    disabled={isGeneratingReply || actionReviewId === replyReview.id}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                                >
                                    {isGeneratingReply ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                    {replyText.trim() ? 'Improve with AI' : 'Draft with AI'}
                                </button>
                            </div>
                            <textarea
                                id="review-reply-text"
                                value={replyText}
                                onChange={(event) => setReplyText(event.target.value)}
                                rows={5}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                placeholder="Thanks for your feedback..."
                                autoFocus
                            />
                        </div>
                        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
                            <button
                                type="button"
                                onClick={closeReplyModal}
                                disabled={!!actionReviewId || isGeneratingReply}
                                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleReply}
                                disabled={actionReviewId === replyReview.id || isGeneratingReply || !replyText.trim()}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                                {actionReviewId === replyReview.id ? 'Posting...' : 'Post reply'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {editReview && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="presentation">
                    <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" role="dialog" aria-modal="true" aria-labelledby="review-edit-title">
                        <div className="border-b border-gray-200 px-6 py-4">
                            <h2 id="review-edit-title" className="text-lg font-semibold text-gray-900">Edit review</h2>
                            <p className="mt-1 text-sm text-gray-500">
                                {editReview.reviewer || 'Customer'} on {editReview.productName || 'Unknown Product'}
                            </p>
                        </div>
                        <div className="space-y-4 px-6 py-5">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <label className="block text-sm font-medium text-gray-700">
                                    Rating
                                    <select
                                        value={editRating}
                                        onChange={(event) => setEditRating(Number(event.target.value))}
                                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                    >
                                        {[5, 4, 3, 2, 1].map((rating) => (
                                            <option key={rating} value={rating}>{rating} star{rating === 1 ? '' : 's'}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="block text-sm font-medium text-gray-700">
                                    Status
                                    <select
                                        value={editStatus}
                                        onChange={(event) => setEditStatus(event.target.value)}
                                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="approved">Approved</option>
                                        <option value="hold">Pending</option>
                                        <option value="spam">Spam</option>
                                        <option value="trash">Trash</option>
                                    </select>
                                </label>
                            </div>
                            <label className="block text-sm font-medium text-gray-700" htmlFor="review-edit-content">
                                Review text
                            </label>
                            <textarea
                                id="review-edit-content"
                                value={editContent}
                                onChange={(event) => setEditContent(event.target.value)}
                                rows={6}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                autoFocus
                            />
                        </div>
                        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
                            <button
                                type="button"
                                onClick={closeEditModal}
                                disabled={!!actionReviewId}
                                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleEditReview}
                                disabled={actionReviewId === editReview.id || !editContent.trim()}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                                {actionReviewId === editReview.id ? 'Saving...' : 'Save changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {mediaViewer && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4" onClick={() => setMediaViewer(null)} role="presentation">
                    <div className="max-h-[90vh] w-full max-w-4xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Review media viewer">
                        <div className="mb-3 flex items-center justify-between text-white">
                            <div className="truncate text-sm">{mediaViewer.filename || mediaViewer.url || 'Review media'}</div>
                            <button type="button" onClick={() => setMediaViewer(null)} className="rounded-md bg-white/10 px-3 py-1 text-sm hover:bg-white/20">
                                Close
                            </button>
                        </div>
                        <div className="flex max-h-[82vh] items-center justify-center overflow-hidden rounded-lg bg-black">
                            {mediaViewer.url && isImageMedia(mediaViewer) ? (
                                <img src={mediaViewer.url} alt={mediaViewer.filename || 'Review media'} className="max-h-[82vh] max-w-full object-contain" />
                            ) : mediaViewer.url && isVideoMedia(mediaViewer) ? (
                                <video src={mediaViewer.url} controls className="max-h-[82vh] max-w-full" />
                            ) : mediaViewer.url ? (
                                <a href={mediaViewer.url} target="_blank" rel="noreferrer" className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100">
                                    Open attachment
                                </a>
                            ) : (
                                <div className="p-8 text-sm text-white">Media URL unavailable</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
