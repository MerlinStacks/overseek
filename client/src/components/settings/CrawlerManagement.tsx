/**
 * CrawlerManagement — Settings component for viewing detected crawlers
 * and managing block/allow rules.
 *
 * Why: Gives admins visibility into bot traffic hitting their store,
 * with the ability to selectively block abusive crawlers.
 */

import { useState, useEffect, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import {
    Loader2, ShieldOff, ShieldCheck, ExternalLink,
    Bot, BarChart3, AlertTriangle
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface CrawlerEntry {
    name: string;
    slug: string;
    category: string;
    categoryLabel: string;
    categoryEmoji: string;
    owner: string;
    description: string;
    website: string;
    intent: 'beneficial' | 'neutral' | 'harmful';
    country: string | null;
    totalHits: number;
    blockedHits: number;
    action: 'ALLOW' | 'BLOCK';
    ruleReason: string | null;
}

interface CrawlerStats {
    crawlers: CrawlerEntry[];
    totalHits24h: number;
    totalBlockedHits24h: number;
    uniqueCrawlers: number;
    blockedCount: number;
}

interface RulePayload {
    crawlerName: string;
    pattern: string;
    action: 'BLOCK' | 'ALLOW';
    reason?: string;
}

const CATEGORY_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'search_engine', label: '🔍 Search' },
    { key: 'ai_crawler', label: '🤖 AI' },
    { key: 'seo_tool', label: '📊 SEO' },
    { key: 'social_preview', label: '🔗 Social' },
    { key: 'monitor', label: '📡 Monitors' },
    { key: 'security_scanner', label: '🛡️ Security' },
    { key: 'http_client', label: '⚙️ HTTP Clients' },
];

const INTENT_CONFIG = {
    beneficial: { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', label: 'Beneficial' },
    neutral: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', label: 'Neutral' },
    harmful: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10', label: 'Harmful' },
} as const;

/**
 * Why country flags: Helps admins identify crawler origin at a glance.
 * Uses Unicode regional indicator symbols — no external dependency.
 */
function countryFlag(code: string | null): string {
    if (!code || code.length !== 2) return '🌐';
    return String.fromCodePoint(
        ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
    );
}

export function CrawlerManagement() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<CrawlerStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [togglingSlug, setTogglingSlug] = useState<string | null>(null);
    const [confirmBlock, setConfirmBlock] = useState<CrawlerEntry | null>(null);

    const fetchCrawlers = useCallback(async (signal?: AbortSignal) => {
        if (!currentAccount || !token) return;

        setError(null);

        try {
            setIsLoading(true);
            const res = await fetch(`/api/crawlers?days=30`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                },
                signal,
            });

            if (!res.ok) throw new Error('Failed to fetch crawler data');

            const result = await res.json();
            setData(result);
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') return;
            Logger.error('Failed to fetch crawlers', { error: err });
            setError('Failed to load crawler data');
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        const controller = new AbortController();
        fetchCrawlers(controller.signal);
        return () => controller.abort();
    }, [fetchCrawlers]);

    const handleToggleBlock = async (crawler: CrawlerEntry) => {
        // Warn before blocking beneficial crawlers (SEO impact)
        if (crawler.intent === 'beneficial' && crawler.action === 'ALLOW') {
            setConfirmBlock(crawler);
            return;
        }
        await executeToggle(crawler);
    };

    const executeToggle = async (crawler: CrawlerEntry) => {
        if (!currentAccount || !token) return;

        setTogglingSlug(crawler.slug);
        setConfirmBlock(null);

        const newAction = crawler.action === 'BLOCK' ? 'ALLOW' : 'BLOCK';
        const payload: RulePayload = {
            crawlerName: crawler.slug,
            pattern: crawler.slug,
            action: newAction,
        };

        try {
            const res = await fetch(`/api/crawlers/rules`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                },
                body: JSON.stringify(payload),
            });

            if (!res.ok) throw new Error('Failed to update rule');
            await fetchCrawlers();
        } catch (err) {
            Logger.error('Failed to toggle crawler rule', { error: err });
            setError('Failed to update block rule');
        } finally {
            setTogglingSlug(null);
        }
    };

    if (!currentAccount) return null;

    const filteredCrawlers = data?.crawlers.filter(
        c => categoryFilter === 'all' || c.category === categoryFilter
    ) || [];

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 dark:bg-purple-500/20 rounded-lg">
                        <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                        <h2 className="text-lg font-medium text-gray-900 dark:text-white">Crawler & Bot Management</h2>
                        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
                            Monitor and control bot traffic hitting your store.
                        </p>
                    </div>
                </div>
            </div>

            <div className="p-6 space-y-6">
                {/* Stats Bar */}
                {data && (
                    <div className="grid grid-cols-4 gap-4">
                        <StatCard icon={<BarChart3 size={18} />} label="Hits (24h)" value={(data.totalHits24h ?? 0).toLocaleString()} color="blue" />
                        <StatCard icon={<ShieldOff size={18} />} label="Blocked (24h)" value={(data.totalBlockedHits24h ?? 0).toLocaleString()} color="red" />
                        <StatCard icon={<Bot size={18} />} label="Unique Crawlers" value={(data.uniqueCrawlers ?? 0).toString()} color="purple" />
                        <StatCard icon={<ShieldOff size={18} />} label="Rules Active" value={(data.blockedCount ?? 0).toString()} color="red" />
                    </div>
                )}

                {/* Category Filters */}
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                    {CATEGORY_FILTERS.map(f => (
                        <button
                            key={f.key}
                            onClick={() => setCategoryFilter(f.key)}
                            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                                categoryFilter === f.key
                                    ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'
                                    : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-600'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {/* Error */}
                {error && (
                    <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg text-red-700 dark:text-red-400 text-sm">
                        {error}
                    </div>
                )}

                {/* Crawler Table */}
                <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 dark:bg-slate-800/50 px-4 py-2.5 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
                        <h3 className="text-sm font-medium text-gray-700 dark:text-slate-300">Detected Crawlers</h3>
                        <span className="text-xs text-gray-400 dark:text-slate-500">Last 30 days</span>
                    </div>

                    {isLoading ? (
                        <div className="p-12 text-center text-gray-500 dark:text-slate-400">
                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                            Loading crawler data...
                        </div>
                    ) : filteredCrawlers.length === 0 ? (
                        <div className="p-12 text-center text-gray-500 dark:text-slate-400">
                            <Bot className="w-8 h-8 mx-auto mb-2 text-gray-400 dark:text-slate-500" />
                            <p className="font-medium">No crawlers detected</p>
                            <p className="text-sm mt-1">Crawler data will appear here once bots visit your store.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
                            {filteredCrawlers.map(crawler => (
                                <CrawlerRow
                                    key={crawler.slug}
                                    crawler={crawler}
                                    isToggling={togglingSlug === crawler.slug}
                                    onToggle={() => handleToggleBlock(crawler)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Confirmation Dialog for blocking beneficial bots */}
            {confirmBlock && (
                <BlockConfirmDialog
                    crawler={confirmBlock}
                    onConfirm={() => executeToggle(confirmBlock)}
                    onCancel={() => setConfirmBlock(null)}
                />
            )}
        </div>
    );
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: {
    icon: React.ReactNode;
    label: string;
    value: string;
    color: 'blue' | 'purple' | 'red';
}) {
    const colors = {
        blue: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400',
        purple: 'bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400',
        red: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400',
    };

    return (
        <div className={`rounded-xl p-4 ${colors[color]}`}>
            <div className="flex items-center gap-2 mb-1">
                {icon}
                <span className="text-xs font-medium opacity-80">{label}</span>
            </div>
            <p className="text-2xl font-bold">{value}</p>
        </div>
    );
}

function CrawlerRow({ crawler, isToggling, onToggle }: {
    crawler: CrawlerEntry;
    isToggling: boolean;
    onToggle: () => void;
}) {
    const intentCfg = INTENT_CONFIG[crawler.intent];
    const isBlocked = crawler.action === 'BLOCK';

    return (
        <div className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
            {/* Name & Owner */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <span
                        className="font-medium text-sm text-gray-900 dark:text-white"
                        title={crawler.slug.startsWith('unknown:') ? crawler.slug : undefined}
                    >
                        {crawler.name}
                    </span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${intentCfg.bg} ${intentCfg.color}`}>
                        {intentCfg.label}
                    </span>
                    {crawler.website && (
                        <a href={crawler.website} target="_blank" rel="noopener noreferrer"
                           className="text-gray-400 dark:text-slate-500 hover:text-blue-500 transition-colors"
                           title="View bot documentation">
                            <ExternalLink size={12} />
                        </a>
                    )}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
                    <span>{crawler.owner}</span>
                    <span className="text-gray-300 dark:text-slate-600">·</span>
                    <span>{crawler.categoryEmoji} {crawler.categoryLabel}</span>
                    {crawler.country && (
                        <>
                            <span className="text-gray-300 dark:text-slate-600">·</span>
                            <span>{countryFlag(crawler.country)} {crawler.country}</span>
                        </>
                    )}
                </div>
            </div>

            {/* Hit Count */}
            <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">{(crawler.totalHits ?? 0).toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 dark:text-slate-500">hits</p>
            </div>

            {/* Blocked Hit Count — only shown when there are blocked hits */}
            {crawler.blockedHits > 0 && (
                <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400">{(crawler.blockedHits ?? 0).toLocaleString()}</p>
                    <p className="text-[10px] text-red-400 dark:text-red-500">blocked</p>
                </div>
            )}

            {/* Block Toggle */}
            <button
                onClick={onToggle}
                disabled={isToggling}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 ${
                    isBlocked
                        ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-500/30'
                        : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-600'
                } disabled:opacity-50`}
                title={isBlocked ? 'Click to allow' : 'Click to block'}
            >
                {isToggling ? (
                    <Loader2 size={14} className="animate-spin" />
                ) : isBlocked ? (
                    <ShieldOff size={14} />
                ) : (
                    <ShieldCheck size={14} />
                )}
                {isBlocked ? 'Blocked' : 'Allowed'}
            </button>
        </div>
    );
}

function BlockConfirmDialog({ crawler, onConfirm, onCancel }: {
    crawler: CrawlerEntry;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
                <div className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-amber-100 dark:bg-amber-500/20 rounded-full">
                            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Block {crawler.name}?</h3>
                    </div>

                    <div className="space-y-3 text-sm text-gray-600 dark:text-slate-300">
                        <p>
                            <strong className="text-gray-900 dark:text-white">{crawler.name}</strong> by{' '}
                            <strong>{crawler.owner}</strong> is classified as{' '}
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">beneficial</span>.
                        </p>
                        <p>{crawler.description}</p>
                        {crawler.category === 'search_engine' && (
                            <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg text-red-700 dark:text-red-400">
                                <strong>⚠️ SEO Warning:</strong> Blocking this search engine crawler will prevent it from indexing your site, which will negatively impact your search rankings.
                            </div>
                        )}
                        {crawler.category === 'social_preview' && (
                            <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg text-amber-700 dark:text-amber-400">
                                <strong>⚠️ Social Sharing:</strong> Blocking this will prevent link previews from appearing when your store URLs are shared on {crawler.owner}.
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex gap-3 p-4 bg-gray-50 dark:bg-slate-900/50 border-t border-gray-200 dark:border-slate-700">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
                    >
                        Block Anyway
                    </button>
                </div>
            </div>
        </div>
    );
}
