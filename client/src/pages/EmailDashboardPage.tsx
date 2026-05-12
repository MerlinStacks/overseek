import { AlertTriangle, Mail, TrendingUp, UserX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '../hooks/useApiQuery';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useEffect, useRef, useState } from 'react';

interface UnsubscribeRow {
    id: string;
    email: string;
    scope: string;
    reason: string | null;
    createdAt: string;
}

interface EmailDashboardResponse {
    days: number;
    rangeStart: string;
    kpis: {
        flowRevenue: number;
        broadcastRevenue: number;
        flowSends: number;
        broadcastSends: number;
        totalUnsubscribes: number;
        bounceRate: number;
        sentCount: number;
        failedCount: number;
    };
    recentUnsubscribes: UnsubscribeRow[];
    trends: Array<{
        date: string;
        unsubscribes: number;
        bounceRate: number;
    }>;
}

function formatMoney(value: number) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2
    }).format(value || 0);
}

function formatNumber(value: number) {
    return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatPercent(value: number) {
    return `${(value || 0).toFixed(2)}%`;
}

export function EmailDashboardPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [days, setDays] = useState(30);
    const unsubscribesSectionRef = useRef<HTMLDivElement | null>(null);
    const focusTimerRef = useRef<number | null>(null);

    const { data, isLoading, error } = useApiQuery<EmailDashboardResponse>({
        queryKey: ['email-dashboard', currentAccount?.id, days],
        enabled: Boolean(token && currentAccount?.id),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        queryFn: async () => {
            const res = await fetch(`/api/marketing/analytics/email-dashboard?days=${days}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });

            if (!res.ok) {
                throw new Error('Failed to load email dashboard');
            }

            return res.json();
        }
    });

    const kpis = data?.kpis;

    const maxUnsubscribes = Math.max(1, ...(data?.trends.map((point) => point.unsubscribes) || [0]));

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const focus = params.get('focus');
        const section = unsubscribesSectionRef.current;

        if (focus === 'unsubscribes' && section) {
            section.dataset.focused = 'true';
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });

            focusTimerRef.current = window.setTimeout(() => {
                if (section) section.dataset.focused = 'false';
            }, 2600);
        }

        return () => {
            if (focusTimerRef.current !== null) {
                window.clearTimeout(focusTimerRef.current);
                focusTimerRef.current = null;
            }
        };
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold text-gray-900">Email Hub</h1>
                    <p className="text-gray-500">Key email performance signals for your selected period.</p>
                </div>
                <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
                    {[7, 30, 90].map((value) => (
                        <button
                            key={value}
                            onClick={() => setDays(value)}
                            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                                days === value
                                    ? 'bg-indigo-600 text-white'
                                    : 'text-gray-600 hover:bg-gray-100'
                            }`}
                        >
                            {value}d
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error.message}
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Link to="/emails/logs?source=AUTOMATION" className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-500">
                        <TrendingUp size={16} /> Flow Revenue
                    </div>
                    <p className="text-2xl font-semibold text-gray-900">{isLoading ? '...' : formatMoney(kpis?.flowRevenue || 0)}</p>
                    <p className="mt-1 text-xs text-gray-500">From automation purchases</p>
                </Link>

                <Link to="/emails/logs?source=CAMPAIGN" className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-500">
                        <Mail size={16} /> Broadcast Revenue
                    </div>
                    <p className="text-2xl font-semibold text-gray-900">{isLoading ? '...' : formatMoney(kpis?.broadcastRevenue || 0)}</p>
                    <p className="mt-1 text-xs text-gray-500">From campaign purchases</p>
                </Link>

                <Link to="/emails?focus=unsubscribes" className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-500">
                        <UserX size={16} /> Unsubscribes
                    </div>
                    <p className="text-2xl font-semibold text-gray-900">{isLoading ? '...' : formatNumber(kpis?.totalUnsubscribes || 0)}</p>
                    <p className="mt-1 text-xs text-gray-500">Unsubscribe events tracked</p>
                </Link>

                <Link to="/emails/logs?status=FAILED,BOUNCED,COMPLAINED" className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-sm">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-500">
                        <AlertTriangle size={16} /> Bounce Rate
                    </div>
                    <p className="text-2xl font-semibold text-gray-900">{isLoading ? '...' : formatPercent(kpis?.bounceRate || 0)}</p>
                    <p className="mt-1 text-xs text-gray-500">
                        {isLoading ? '...' : `${formatNumber(kpis?.failedCount || 0)} failed of ${formatNumber(kpis?.sentCount || 0)} sends`}
                    </p>
                </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-sm font-medium text-gray-500">Flow Sends</p>
                    <p className="mt-2 text-2xl font-semibold text-gray-900">{isLoading ? '...' : formatNumber(kpis?.flowSends || 0)}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-sm font-medium text-gray-500">Broadcast Sends</p>
                    <p className="mt-2 text-2xl font-semibold text-gray-900">{isLoading ? '...' : formatNumber(kpis?.broadcastSends || 0)}</p>
                </div>
            </div>

            <div
                ref={unsubscribesSectionRef}
                data-focused="false"
                className="rounded-xl border border-gray-200 bg-white transition-all duration-700 data-[focused=true]:border-indigo-400 data-[focused=true]:shadow-lg data-[focused=true]:shadow-indigo-100 data-[focused=true]:ring-2 data-[focused=true]:ring-indigo-200"
            >
                <div className="border-b border-gray-200 px-4 py-3">
                    <h2 className="text-sm font-semibold text-gray-900">Delivery Trend</h2>
                </div>
                <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
                    <div>
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Unsubscribes per day</p>
                        <div className="space-y-1">
                            {(data?.trends.slice(-10) || []).map((point) => (
                                <div key={point.date} className="flex items-center gap-2">
                                    <span className="w-16 text-xs text-gray-500">{point.date.slice(5)}</span>
                                    <div className="h-2 flex-1 overflow-hidden rounded bg-gray-100">
                                        <div
                                            className="h-full rounded bg-indigo-500"
                                            style={{ width: `${Math.max(4, (point.unsubscribes / maxUnsubscribes) * 100)}%` }}
                                        />
                                    </div>
                                    <span className="w-8 text-right text-xs text-gray-700">{point.unsubscribes}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Bounce rate per day</p>
                        <div className="space-y-1">
                            {(data?.trends.slice(-10) || []).map((point) => (
                                <div key={`${point.date}-bounce`} className="flex items-center justify-between rounded bg-gray-50 px-2 py-1">
                                    <span className="text-xs text-gray-500">{point.date}</span>
                                    <span className="text-xs font-medium text-gray-700">{formatPercent(point.bounceRate)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white">
                <div className="border-b border-gray-200 px-4 py-3">
                    <h2 className="text-sm font-semibold text-gray-900">Recent 10 Unsubscribes</h2>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-500">Scope</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-500">Reason</th>
                                <th className="px-4 py-3 text-left font-medium text-gray-500">Unsubscribed At</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {isLoading && (
                                <tr>
                                    <td colSpan={4} className="px-4 py-4 text-gray-500">Loading unsubscribes...</td>
                                </tr>
                            )}

                            {!isLoading && (data?.recentUnsubscribes.length || 0) === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-4 py-4 text-gray-500">No recent unsubscribes found.</td>
                                </tr>
                            )}

                            {!isLoading && data?.recentUnsubscribes.map((row) => (
                                <tr key={row.id}>
                                    <td className="whitespace-nowrap px-4 py-3 text-gray-900">{row.email}</td>
                                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">{row.scope}</td>
                                    <td className="px-4 py-3 text-gray-700">{row.reason || 'No reason provided'}</td>
                                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                                        {new Date(row.createdAt).toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
