/**
 * Ad Intelligence Panel
 *
 * Displays the SC↔Ads correlation data: cannibalization, organic-only
 * keywords, and negative keyword suggestions. Uses skeleton-first rendering
 * for instant perceived load.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Skeleton, SkeletonText } from '../ui/Skeleton';
import {
    AlertTriangle,
    TrendingUp,
    Ban,
    Zap,
    ArrowRight,
    ChevronDown,
    ChevronUp,
    Loader2,
    Search,
    DollarSign
} from 'lucide-react';
import { Logger } from '../../utils/logger';

/* ────────── Types (mirrors server response shapes) ────────── */

interface IntelligenceSummary {
    overlapCount: number;
    organicOnlyCount: number;
    estimatedWastedSpend: number;
    estimatedUntappedValue: number;
    cannibalizationCount: number;
    negativeCandidates: number;
    estimatedMonthlySavings: number;
    hasData: boolean;
}

interface OverlapQuery {
    query: string;
    organic: { clicks: number; impressions: number; ctr: number; position: number };
    paid: { clicks: number; impressions: number; spend: number; cpc: number; conversions: number; roas: number };
    estimatedWastedSpend: number;
    cannibalizationScore: number;
}

interface OrganicOnlyQuery {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    estimatedPaidValue: number;
}

interface Correlation {
    overlap: OverlapQuery[];
    organicOnly: OrganicOnlyQuery[];
    paidOnlyCount: number;
    summary: {
        totalOrganicQueries: number;
        totalPaidKeywords: number;
        overlapCount: number;
        organicOnlyCount: number;
        estimatedTotalWastedSpend: number;
        estimatedUntappedValue: number;
    };
}

/* ────────── Sub-components ───────────────────────────────── */

function SummaryCards({ data }: { data: IntelligenceSummary }) {
    const cards = [
        { label: 'Cannibalized Keywords', value: data.cannibalizationCount, icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
        { label: 'Est. Wasted Spend/mo', value: `$${data.estimatedWastedSpend.toFixed(0)}`, icon: DollarSign, color: 'text-red-400', bg: 'bg-red-500/10' },
        { label: 'Organic Opportunities', value: data.organicOnlyCount, icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
        { label: 'Neg Keyword Candidates', value: data.negativeCandidates, icon: Ban, color: 'text-blue-400', bg: 'bg-blue-500/10' }
    ];

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {cards.map(c => (
                <div key={c.label} className={`${c.bg} rounded-xl p-4 border border-white/5`}>
                    <div className="flex items-center gap-2 mb-2">
                        <c.icon className={`w-4 h-4 ${c.color}`} />
                        <span className="text-xs text-white/50 uppercase tracking-wide">{c.label}</span>
                    </div>
                    <div className="text-2xl font-bold text-white">{c.value}</div>
                </div>
            ))}
        </div>
    );
}

function SummaryCardsSkeleton() {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white/5 rounded-xl p-4 border border-white/5">
                    <Skeleton className="h-4 w-24 mb-3" />
                    <Skeleton className="h-8 w-16" />
                </div>
            ))}
        </div>
    );
}

/** Expandable section wrapper */
function Section({ title, icon: Icon, count, color, children, defaultOpen = false }: {
    title: string; icon: any; count: number; color: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="bg-white/[0.03] border border-white/5 rounded-xl mb-4 overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
            >
                <div className="flex items-center gap-3">
                    <Icon className={`w-5 h-5 ${color}`} />
                    <span className="font-semibold text-white">{title}</span>
                    <span className="text-xs bg-white/10 text-white/70 px-2 py-0.5 rounded-full">{count}</span>
                </div>
                {open ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
            </button>
            {open && <div className="px-5 pb-4">{children}</div>}
        </div>
    );
}

/* ────────── Main Component ──────────────────────────────── */

export function AdIntelligencePanel() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [summary, setSummary] = useState<IntelligenceSummary | null>(null);
    const [correlation, setCorrelation] = useState<Correlation | null>(null);
    const [loadingSummary, setLoadingSummary] = useState(true);
    const [loadingCorrelation, setLoadingCorrelation] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /** Build auth headers fresh on each request to avoid stale closures */
    function getHeaders() {
        return {
            'Authorization': `Bearer ${token}`,
            'X-Account-ID': currentAccount?.id || ''
        };
    }

    /** Load summary immediately, correlation lazily */
    useEffect(() => {
        loadSummary();
    }, [currentAccount?.id]);

    async function loadSummary() {
        setLoadingSummary(true);
        setError(null);
        try {
            const res = await fetch(`/api/ads/intelligence/summary`, { headers: getHeaders() });
            if (!res.ok) throw new Error('Failed to load intelligence summary');
            const data = await res.json();
            setSummary(data);

            // Auto-load full correlation after summary renders
            if (data.hasData) loadCorrelation();
        } catch (err: any) {
            Logger.error('Intelligence summary load failed', err);
            setError(err.message);
        } finally {
            setLoadingSummary(false);
        }
    }

    async function loadCorrelation() {
        setLoadingCorrelation(true);
        try {
            const res = await fetch(`/api/ads/intelligence/correlation`, { headers: getHeaders() });
            if (!res.ok) throw new Error('Failed to load correlation data');
            setCorrelation(await res.json());
        } catch (err: any) {
            Logger.error('Intelligence correlation load failed', err);
        } finally {
            setLoadingCorrelation(false);
        }
    }

    /* ── No data ── */
    if (!loadingSummary && summary && !summary.hasData) {
        return (
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-8 text-center">
                <Search className="w-10 h-10 text-white/20 mx-auto mb-3" />
                <p className="text-white/60 text-sm">
                    No search intelligence data yet. Connect both Search Console and Google Ads to see organic↔paid insights.
                </p>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="flex items-center gap-3 mb-5">
                <Zap className="w-5 h-5 text-violet-400" />
                <h2 className="text-lg font-semibold text-white">Search Intelligence</h2>
                {loadingSummary && <Loader2 className="w-4 h-4 animate-spin text-white/40" />}
            </div>

            {/* Summary Cards — skeleton first */}
            {loadingSummary ? <SummaryCardsSkeleton /> : summary && <SummaryCards data={summary} />}

            {/* Correlation sections — load progressively */}
            {loadingCorrelation && (
                <div className="space-y-4 mb-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
                            <Skeleton className="h-5 w-48 mb-3" />
                            <SkeletonText lines={3} />
                        </div>
                    ))}
                </div>
            )}

            {correlation && (
                <>
                    {/* Cannibalization */}
                    {(() => {
                        const cannibalized = correlation.overlap.filter(o => o.cannibalizationScore >= 50);
                        if (cannibalized.length === 0) return null;
                        return (
                            <Section
                                title="Cannibalized Keywords"
                                icon={AlertTriangle}
                                count={cannibalized.length}
                                color="text-amber-400"
                                defaultOpen
                            >
                                <div className="space-y-2">
                                    {cannibalized.slice(0, 10).map(o => (
                                        <CannibalizationRow key={o.query} data={o} />
                                    ))}
                                </div>
                            </Section>
                        );
                    })()}

                    {/* Organic Keyword Opportunities */}
                    {correlation.organicOnly.length > 0 && (
                        <Section
                            title="Organic Keyword Opportunities"
                            icon={TrendingUp}
                            count={correlation.organicOnly.length}
                            color="text-emerald-400"
                        >
                            <div className="space-y-2">
                                {correlation.organicOnly.slice(0, 10).map(o => (
                                    <OrganicOpportunityRow key={o.query} data={o} />
                                ))}
                            </div>
                        </Section>
                    )}
                </>
            )}

            {/* Error state */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">
                    {error}
                </div>
            )}
        </div>
    );
}

/* ────────── Row Components ──────────────────────────────── */

function CannibalizationRow({ data }: { data: OverlapQuery }) {
    return (
        <div className="bg-white/[0.03] rounded-lg p-3 flex items-center justify-between gap-4 hover:bg-white/[0.05] transition-colors">
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">"{data.query}"</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-white/50">
                    <span>Organic #{data.organic.position.toFixed(0)} · {data.organic.ctr.toFixed(1)}% CTR</span>
                    <ArrowRight className="w-3 h-3" />
                    <span>Paid ${data.paid.spend.toFixed(0)} · {data.paid.roas.toFixed(1)}x ROAS</span>
                </div>
            </div>
            <div className="text-right shrink-0">
                <p className="text-sm font-medium text-amber-400">~${data.estimatedWastedSpend.toFixed(0)}/mo</p>
                <p className="text-xs text-white/40">{data.cannibalizationScore}% confidence</p>
            </div>
        </div>
    );
}

function OrganicOpportunityRow({ data }: { data: OrganicOnlyQuery }) {
    return (
        <div className="bg-white/[0.03] rounded-lg p-3 flex items-center justify-between gap-4 hover:bg-white/[0.05] transition-colors">
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">"{data.query}"</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-white/50">
                    <span>Position #{data.position.toFixed(0)}</span>
                    <span>·</span>
                    <span>{data.clicks} organic clicks</span>
                    <span>·</span>
                    <span>{data.ctr.toFixed(1)}% CTR</span>
                </div>
            </div>
            <div className="text-right shrink-0">
                <p className="text-sm font-medium text-emerald-400">~${data.estimatedPaidValue.toFixed(0)}/mo</p>
                <p className="text-xs text-white/40">est. paid value</p>
            </div>
        </div>
    );
}
