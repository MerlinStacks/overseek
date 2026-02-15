/**
 * SeoPage — Standalone page for SEO keyword insights and tracking.
 *
 * Premium design: gradient header, glass pill tabs, animated tab content.
 * Why a separate page: SEO tracking has enough depth to warrant its own
 * space separate from the Marketing hub.
 *
 * Why selectedSiteUrl lives here: both the Overview and Tracker tabs
 * benefit from a shared domain context so users don't have to re-select
 * when switching tabs.
 */

import { useState, useEffect } from 'react';
import { Target, TrendingUp, Globe, ChevronDown } from 'lucide-react';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { SeoKeywordsPanel } from '../components/Seo/SeoKeywordsPanel';
import { KeywordTrackerPanel } from '../components/Seo/KeywordTrackerPanel';
import { useSearchConsoleStatus, useSetDefaultSite } from '../hooks/useSeoKeywords';

type TabId = 'overview' | 'tracker';

const tabs = [
    { id: 'overview' as TabId, label: 'SEO Overview', icon: Target },
    { id: 'tracker' as TabId, label: 'Keyword Tracker', icon: TrendingUp },
];

/**
 * Extract a human-readable label from a GSC siteUrl.
 * "sc-domain:example.com" → "example.com"
 * "https://example.com/" → "example.com"
 */
function prettySiteUrl(raw: string): string {
    return raw
        .replace(/^sc-domain:/, '')
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
}

export function SeoPage() {
    const [activeTab, setActiveTab] = useState<TabId>('overview');
    const status = useSearchConsoleStatus();
    const sites = status.data?.sites ?? [];
    const [selectedSiteUrl, setSelectedSiteUrl] = useState<string | undefined>();
    const setDefaultSite = useSetDefaultSite();

    /** Initialize from the persisted default, falling back to first site */
    useEffect(() => {
        if (sites.length > 0 && !selectedSiteUrl) {
            const defaultUrl = status.data?.defaultSiteUrl;
            // Use the persisted default if it's still in the connected sites list
            const validDefault = defaultUrl && sites.some(s => s.siteUrl === defaultUrl);
            setSelectedSiteUrl(validDefault ? defaultUrl : sites[0].siteUrl);
        }
    }, [sites, selectedSiteUrl, status.data?.defaultSiteUrl]);

    return (
        <div className="space-y-8">
            {/* Hero Header with mesh background */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 via-blue-50/50 to-violet-50/30 dark:from-slate-900 dark:via-blue-950/30 dark:to-violet-950/20 border border-slate-200/60 dark:border-slate-700/40 px-8 py-8">
                {/* Decorative gradient orbs */}
                <div className="absolute -top-20 -right-20 w-64 h-64 bg-blue-400/10 dark:bg-blue-500/5 rounded-full blur-3xl" />
                <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-violet-400/10 dark:bg-violet-500/5 rounded-full blur-3xl" />

                <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex flex-col gap-2">
                        <h1 className="text-3xl font-bold tracking-tight text-gradient">
                            SEO & Organic Search
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 max-w-lg">
                            Monitor organic search performance, track keyword rankings, and discover growth opportunities.
                        </p>
                    </div>

                    {/* Domain selector — only visible when GSC is connected */}
                    {sites.length > 0 && (
                        <div className="shrink-0">
                            {sites.length === 1 ? (
                                /* Single site: static badge */
                                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/70 dark:bg-slate-800/60 backdrop-blur-sm border border-slate-200/60 dark:border-slate-700/40 text-sm font-medium text-slate-700 dark:text-slate-300">
                                    <Globe size={14} className="text-blue-500" />
                                    {prettySiteUrl(sites[0].siteUrl)}
                                </div>
                            ) : (
                                /* Multiple sites: dropdown selector */
                                <div className="relative inline-flex items-center">
                                    <Globe size={14} className="absolute left-3 text-blue-500 pointer-events-none z-10" />
                                    <select
                                        id="seo-domain-selector"
                                        value={selectedSiteUrl ?? ''}
                                        onChange={e => {
                                            const url = e.target.value;
                                            setSelectedSiteUrl(url);
                                            setDefaultSite.mutate(url);
                                        }}
                                        className="appearance-none pl-8 pr-8 py-2 rounded-xl bg-white/70 dark:bg-slate-800/60 backdrop-blur-sm border border-slate-200/60 dark:border-slate-700/40 text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer hover:border-blue-300 dark:hover:border-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                    >
                                        {sites.map(site => (
                                            <option key={site.id} value={site.siteUrl}>
                                                {prettySiteUrl(site.siteUrl)}
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown size={14} className="absolute right-2.5 text-slate-400 pointer-events-none" />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Glass Pill Tabs */}
            <div className="flex bg-slate-100/80 dark:bg-slate-800/60 backdrop-blur-sm p-1 rounded-xl border border-slate-200/50 dark:border-slate-700/40 w-fit">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-5 py-2.5 font-medium text-sm rounded-lg transition-all duration-200 ${isActive
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                        >
                            <Icon size={16} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Animated Tab Content */}
            <div key={activeTab} className="animate-fade-slide-up">
                {activeTab === 'overview' && (
                    <ErrorBoundary>
                        <SeoKeywordsPanel siteUrl={selectedSiteUrl} />
                    </ErrorBoundary>
                )}

                {activeTab === 'tracker' && (
                    <ErrorBoundary>
                        <KeywordTrackerPanel />
                    </ErrorBoundary>
                )}
            </div>
        </div>
    );
}
