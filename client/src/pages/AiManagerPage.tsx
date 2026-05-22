import { useMemo, useState } from 'react';
import { Bot, RefreshCw, Sparkles, TrendingUp, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useApiMutation, useApiQuery } from '../hooks/useApiQuery';

type SuggestionStatus = 'pending' | 'implemented' | 'dismissed';

interface AiManagerSuggestion {
    id: string;
    title: string;
    text: string;
    type: string;
    source: string;
    priority: 1 | 2 | 3;
    confidence: number;
    status: SuggestionStatus;
    createdAt: string;
    dataPoints: string[];
}

interface SuggestionResponse {
    items: AiManagerSuggestion[];
}

interface SourceHealth {
    searchConsoleConnected: boolean;
    googleAdsConnected: boolean;
    metaAdsConnected: boolean;
}

export function AiManagerPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [statusFilter, setStatusFilter] = useState<'all' | SuggestionStatus>('all');

    const suggestionsQuery = useApiQuery<SuggestionResponse>({
        queryKey: ['ai-manager', currentAccount?.id, statusFilter],
        enabled: Boolean(token && currentAccount?.id),
        refetchOnWindowFocus: false,
        queryFn: async () => {
            if (!token || !currentAccount?.id) throw new Error('Account context is required');
            const params = new URLSearchParams();
            if (statusFilter !== 'all') params.set('status', statusFilter);
            params.set('limit', '60');
            const res = await fetch(`/api/ai-manager/suggestions?${params.toString()}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                }
            });
            if (!res.ok) throw new Error('Failed to load AI manager suggestions');
            return await res.json();
        }
    });

    const healthQuery = useApiQuery<SourceHealth>({
        queryKey: ['ai-manager-health', currentAccount?.id],
        enabled: Boolean(token && currentAccount?.id),
        refetchOnWindowFocus: false,
        queryFn: async () => {
            if (!token || !currentAccount?.id) throw new Error('Account context is required');
            const res = await fetch('/api/ai-manager/health', {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                }
            });
            if (!res.ok) throw new Error('Failed to load source health');
            return await res.json();
        }
    });

    const refreshMutation = useApiMutation<{ created: number }>({
        mutationFn: async () => {
            if (!token || !currentAccount?.id) throw new Error('Account context is required');
            const res = await fetch('/api/ai-manager/suggestions/refresh', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                    'content-type': 'application/json',
                },
            });
            if (!res.ok) throw new Error('Failed to refresh suggestions');
            return await res.json();
        },
        onSuccess: () => {
            void suggestionsQuery.refetch();
        }
    });

    const statusMutation = useApiMutation<{ success: boolean }, { id: string; status: 'implemented' | 'dismissed' }>({
        mutationFn: async ({ id, status }) => {
            if (!token || !currentAccount?.id) throw new Error('Account context is required');
            const res = await fetch(`/api/ai-manager/suggestions/${id}/status`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ status }),
            });
            if (!res.ok) throw new Error('Failed to update suggestion status');
            return await res.json();
        },
        onSuccess: () => {
            void suggestionsQuery.refetch();
        }
    });

    const items = useMemo(() => suggestionsQuery.data?.items ?? [], [suggestionsQuery.data?.items]);

    const stats = useMemo(() => {
        const pending = items.filter(i => i.status === 'pending').length;
        const reviewed = items.filter(i => i.status === 'implemented').length;
        const highPriority = items.filter(i => i.priority === 1 && i.status === 'pending').length;
        return { pending, reviewed, highPriority, total: items.length };
    }, [items]);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">AI Manager</h1>
                    <p className="text-slate-600 dark:text-slate-400">Proactive SEO and ads recommendations only. AI Manager never applies actions.</p>
                </div>
                <button
                    onClick={() => refreshMutation.mutate()}
                    disabled={refreshMutation.isPending}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
                >
                    <RefreshCw size={16} className={refreshMutation.isPending ? 'animate-spin' : ''} />
                    Refresh Suggestions
                </button>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
                <StatCard icon={Bot} label="Total" value={stats.total} />
                <StatCard icon={Sparkles} label="Pending" value={stats.pending} />
                <StatCard icon={TrendingUp} label="High Priority" value={stats.highPriority} />
                <StatCard icon={XCircle} label="Reviewed" value={stats.reviewed} />
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Source Health</p>
                <div className="flex flex-wrap gap-2">
                    <SourcePill label="Search Console" connected={Boolean(healthQuery.data?.searchConsoleConnected)} />
                    <SourcePill label="Google Ads" connected={Boolean(healthQuery.data?.googleAdsConnected)} />
                    <SourcePill label="Meta Ads" connected={Boolean(healthQuery.data?.metaAdsConnected)} />
                </div>
            </div>

            <div className="flex items-center gap-2">
                {(['all', 'pending', 'implemented', 'dismissed'] as const).map((status) => (
                    <button
                        key={status}
                        onClick={() => setStatusFilter(status)}
                        className={`px-3 py-1.5 rounded-lg text-sm border ${statusFilter === status
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30'
                            : 'bg-white text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`}
                    >
                        {status === 'all' ? 'All' : status}
                    </button>
                ))}
            </div>

            {suggestionsQuery.isLoading && <div className="text-sm text-slate-500">Loading suggestions...</div>}
            {suggestionsQuery.error && <div className="text-sm text-red-600">Failed to load suggestions.</div>}

            <div className="space-y-3">
                {items.map((item) => (
                    <article key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{item.title}</h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.type} · {item.source} · confidence {item.confidence}%</p>
                            </div>
                            <span className={`text-xs px-2 py-1 rounded-full ${item.priority === 1
                                ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                                : item.priority === 2
                                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                                    : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}`}
                            >
                                P{item.priority}
                            </span>
                        </div>

                        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{item.text}</p>

                        {item.dataPoints.length > 0 && (
                            <div className="mt-3 grid gap-1">
                                {item.dataPoints.slice(0, 4).map((point, idx) => (
                                    <p key={idx} className="text-xs text-slate-500 dark:text-slate-400">- {point}</p>
                                ))}
                            </div>
                        )}

                        <div className="mt-3 flex items-center gap-2">
                            {item.status === 'pending' ? (
                                <>
                                    <button
                                        onClick={() => statusMutation.mutate({ id: item.id, status: 'implemented' })}
                                        className="px-3 py-1.5 text-xs font-medium rounded-md bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                                    >
                                        Mark Reviewed
                                    </button>
                                    <button
                                        onClick={() => statusMutation.mutate({ id: item.id, status: 'dismissed' })}
                                        className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
                                    >
                                        Dismiss
                                    </button>
                                </>
                            ) : (
                                <span className="text-xs text-slate-500 dark:text-slate-400">Status: {item.status}</span>
                            )}
                        </div>
                    </article>
                ))}
                {!suggestionsQuery.isLoading && items.length === 0 && (
                    <div className="text-sm text-slate-500">No suggestions yet. Click Refresh Suggestions to generate the first batch.</div>
                )}
            </div>
        </div>
    );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <Icon size={14} />
                <span className="text-xs uppercase tracking-wide">{label}</span>
            </div>
            <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-2">{value}</p>
        </div>
    );
}

function SourcePill({ label, connected }: { label: string; connected: boolean }) {
    return (
        <span
            className={`px-2.5 py-1 text-xs rounded-full border ${connected
                ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/30'
                : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30'}`}
        >
            {label}: {connected ? 'Connected' : 'Not Connected'}
        </span>
    );
}
