import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle, MessageSquare, RefreshCw, Search, Star } from 'lucide-react';
import { Logger } from '../../utils/logger';
import { formatDate } from '../../utils/format';
import { formatReviewStatusLabel, formatReviewText } from '../../utils/reviews';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useHaptic } from '../../hooks/useHaptic';
import { ListSkeleton } from '../../components/mobile/MobileSkeleton';

interface ReviewRow {
    id: string;
    productName?: string;
    reviewer?: string;
    reviewerEmail?: string;
    rating: number;
    content?: string;
    dateCreated: string;
    status: string;
    order?: { wooId?: number; number?: string };
}

interface StatusCounts {
    total: number;
    counts: Record<string, number>;
}

const PAGE_SIZE = 20;

const STATUS_TABS = [
    { value: 'all', label: 'All' },
    { value: 'hold', label: 'Pending' },
    { value: 'approved', label: 'Published' },
    { value: 'spam', label: 'Spam' },
    { value: 'trash', label: 'Trash' },
] as const;

const STATUS_CLASSES: Record<string, string> = {
    approved: 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/20',
    hold: 'bg-amber-400/15 text-amber-100 ring-amber-300/20',
    spam: 'bg-slate-400/15 text-slate-200 ring-white/10',
    trash: 'bg-rose-400/15 text-rose-100 ring-rose-300/20',
};

export function MobileReviews() {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const toast = useToast();
    const { triggerHaptic } = useHaptic();
    const [reviews, setReviews] = useState<ReviewRow[]>([]);
    const [statusCounts, setStatusCounts] = useState<StatusCounts>({ total: 0, counts: {} });
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionReviewId, setActionReviewId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeStatus, setActiveStatus] = useState('all');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [expandedReviewIds, setExpandedReviewIds] = useState<string[]>([]);

    const expandedReviewSet = useMemo(() => new Set(expandedReviewIds), [expandedReviewIds]);

    const fetchReviews = useCallback(async (targetPage: number, reset = false) => {
        if (!currentAccount || !token) {
            setIsLoading(false);
            return;
        }

        if (reset) {
            setIsLoading(true);
            setError(null);
        }

        try {
            const params = new URLSearchParams({
                page: String(targetPage),
                limit: String(PAGE_SIZE),
                accountId: currentAccount.id,
            });
            if (searchQuery.trim()) params.append('search', searchQuery.trim());
            if (activeStatus !== 'all') params.append('status', activeStatus);

            const res = await fetch(`/api/reviews?${params}`, {
                headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount.id },
            });
            if (!res.ok) throw new Error('Failed to fetch reviews');

            const data = await res.json() as { reviews?: ReviewRow[]; pagination?: { pages?: number }; statusCounts?: StatusCounts };
            setReviews((current) => reset ? data.reviews || [] : [...current, ...(data.reviews || [])]);
            setTotalPages(data.pagination?.pages || 1);
            setPage(targetPage);
            setStatusCounts(data.statusCounts || { total: 0, counts: {} });
            setError(null);
        } catch (error) {
            Logger.error('[MobileReviews] Failed to fetch reviews', { error });
            setError('Could not load reviews. Pull down or tap retry to refresh.');
            toast.error('Could not load reviews.');
        } finally {
            setIsLoading(false);
        }
    }, [activeStatus, currentAccount, searchQuery, toast, token]);

    useEffect(() => {
        void fetchReviews(1, true);

        const handleRefresh = () => void fetchReviews(1, true);
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [fetchReviews]);

    const handleSearch = (event: FormEvent) => {
        event.preventDefault();
        triggerHaptic();
        void fetchReviews(1, true);
    };

    const handleStatusChange = (status: string) => {
        triggerHaptic();
        setActiveStatus(status);
    };

    const handleModerate = async (reviewId: string, status: string) => {
        if (!currentAccount || !token) return;

        setActionReviewId(reviewId);
        try {
            const res = await fetch(`/api/reviews/${reviewId}/moderate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                },
                body: JSON.stringify({ status }),
            });

            const result = await res.json().catch(() => ({})) as { error?: string };
            if (!res.ok) throw new Error(result.error || 'Moderation failed');

            triggerHaptic(15);
            toast.success(`Review marked ${formatReviewStatusLabel(status).toLowerCase()}`);
            void fetchReviews(1, true);
        } catch (error) {
            Logger.error('[MobileReviews] Review moderation failed', { error });
            toast.error(error instanceof Error ? error.message : 'Failed to update review');
        } finally {
            setActionReviewId(null);
        }
    };

    const toggleExpanded = (reviewId: string) => {
        setExpandedReviewIds((current) => current.includes(reviewId)
            ? current.filter((id) => id !== reviewId)
            : [...current, reviewId]);
    };

    if (isLoading && reviews.length === 0) return <ListSkeleton count={6} />;

    if (error && reviews.length === 0) {
        return (
            <div className="rounded-[1.5rem] border border-rose-400/20 bg-rose-500/10 p-5 text-center text-rose-100">
                <p className="mb-4 text-sm font-medium">{error}</p>
                <button
                    onClick={() => void fetchReviews(1, true)}
                    className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 active:scale-[0.98]"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4 pb-28 animate-fade-slide-up">
            <div>
                <h1 className="text-2xl font-black text-white">Reviews</h1>
                <p className="mt-1 text-sm text-slate-400">Read and moderate store feedback.</p>
            </div>

            <form onSubmit={handleSearch} className="sticky top-2 z-10">
                <div className="relative rounded-2xl border border-white/10 bg-slate-950/90 shadow-xl shadow-black/20 backdrop-blur-xl">
                    <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="search"
                        placeholder="Search reviews..."
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        className="w-full bg-transparent py-3.5 pl-11 pr-4 text-[15px] text-white placeholder-slate-500 outline-none"
                    />
                </div>
            </form>

            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
                {STATUS_TABS.map((tab) => {
                    const count = tab.value === 'all' ? statusCounts.total : statusCounts.counts[tab.value] || 0;
                    const isActive = activeStatus === tab.value;

                    return (
                        <button
                            key={tab.value}
                            onClick={() => handleStatusChange(tab.value)}
                            className={`min-w-[108px] rounded-2xl px-3 py-3 text-left transition active:scale-95 ${isActive ? 'bg-white text-slate-950 shadow-lg' : 'bg-slate-900/80 text-slate-300 ring-1 ring-white/10'}`}
                        >
                            <span className="block text-sm font-black">{tab.label}</span>
                            <span className={`mt-1 block text-xs ${isActive ? 'text-slate-500' : 'text-slate-500'}`}>{count.toLocaleString()}</span>
                        </button>
                    );
                })}
            </div>

            <div className="space-y-3">
                {reviews.length === 0 ? (
                    <div className="rounded-[2rem] border border-white/10 bg-slate-950 px-5 py-14 text-center">
                        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/[0.06]">
                            <MessageSquare className="text-slate-500" size={36} />
                        </div>
                        <p className="text-lg font-black text-white">No reviews found</p>
                        <p className="mt-1 text-sm text-slate-400">Switch filters or pull to refresh.</p>
                    </div>
                ) : (
                    reviews.map((review, index) => (
                        <ReviewCard
                            key={review.id}
                            review={review}
                            index={index}
                            isExpanded={expandedReviewSet.has(review.id)}
                            isUpdating={actionReviewId === review.id}
                            onToggleExpanded={() => toggleExpanded(review.id)}
                            onModerate={(status) => void handleModerate(review.id, status)}
                        />
                    ))
                )}

                {page < totalPages && reviews.length > 0 && (
                    <button
                        onClick={() => fetchReviews(page + 1, false)}
                        disabled={isLoading}
                        className="w-full rounded-2xl border border-white/10 bg-slate-900 py-4 text-sm font-black text-indigo-200 disabled:opacity-50"
                    >
                        {isLoading ? 'Loading...' : 'Load more reviews'}
                    </button>
                )}
            </div>
        </div>
    );
}

interface ReviewCardProps {
    review: ReviewRow;
    index: number;
    isExpanded: boolean;
    isUpdating: boolean;
    onToggleExpanded: () => void;
    onModerate: (status: string) => void;
}

function ReviewCard({ review, index, isExpanded, isUpdating, onToggleExpanded, onModerate }: ReviewCardProps) {
    const reviewText = formatReviewText(review.content);
    const canExpand = reviewText.length > 160 || reviewText.includes('\n');
    const statusClass = STATUS_CLASSES[review.status] || STATUS_CLASSES.hold;

    return (
        <article className="rounded-[1.5rem] border border-white/10 bg-slate-950 p-4 shadow-lg shadow-black/20" style={{ animationDelay: `${index * 12}ms` }}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <p className="truncate text-base font-black text-white">{review.reviewer || 'Customer'}</p>
                        {review.order && <CheckCircle size={15} className="shrink-0 text-emerald-300" />}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-400">{review.productName || 'Unknown product'}</p>
                    <p className="mt-1 text-xs text-slate-600">{formatDate(review.dateCreated)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${statusClass}`}>{formatReviewStatusLabel(review.status)}</span>
            </div>

            <div className="mt-3 flex items-center gap-0.5 text-amber-300">
                {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} size={16} fill={i < review.rating ? 'currentColor' : 'none'} strokeWidth={1.5} />
                ))}
            </div>

            <div className="mt-3 text-sm leading-6 text-slate-200">
                {reviewText ? (
                    <>
                        <p className={isExpanded ? 'whitespace-pre-wrap' : 'line-clamp-3'}>{reviewText}</p>
                        {canExpand && (
                            <button type="button" onClick={onToggleExpanded} className="mt-2 text-xs font-black text-indigo-200">
                                {isExpanded ? 'Show less' : 'Read full review'}
                            </button>
                        )}
                    </>
                ) : (
                    <p className="text-slate-500">No review text</p>
                )}
            </div>

            <div className="mt-4 border-t border-white/5 pt-3">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor={`mobile-review-status-${review.id}`}>Moderation</label>
                <select
                    id={`mobile-review-status-${review.id}`}
                    value={review.status}
                    disabled={isUpdating}
                    onChange={(event) => event.target.value !== review.status && onModerate(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-3 text-sm font-black text-white outline-none disabled:opacity-50"
                >
                    <option value="approved">Published</option>
                    <option value="hold">Pending</option>
                    <option value="spam">Spam</option>
                    <option value="trash">Trash</option>
                </select>
            </div>
        </article>
    );
}
