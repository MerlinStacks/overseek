/**
 * SeoPage — Standalone page for SEO keyword insights and tracking.
 *
 * Search workspace with neutral panels and business-branded navigation.
 * Why a separate page: SEO tracking has enough depth to warrant its own
 * space separate from the Marketing hub.
 *
 * Why selectedSiteUrl lives here: both the Overview and Tracker tabs
 * benefit from a shared domain context so users don't have to re-select
 * when switching tabs.
 */

import { useState, useMemo } from 'react';
import { Target, TrendingUp, Globe, ChevronDown } from 'lucide-react';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { SeoKeywordsPanel } from '../components/Seo/SeoKeywordsPanel';
import { KeywordTrackerPanel } from '../components/Seo/KeywordTrackerPanel';
import { useSearchConsoleStatus, useSetDefaultSite } from '../hooks/useSeoKeywords';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useScopedMutation } from '../hooks/useScopedMutation';
import { isRecord } from '../utils/responseValidation';

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
    const { user, token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p>Sign in and select an account to view SEO data.</p>;
    return <ScopedSeoPage key={JSON.stringify([user?.id, token, currentAccount.id])} />;
}
function ScopedSeoPage() {
    const [activeTab, setActiveTab] = useState<TabId>('overview');
    const status = useSearchConsoleStatus();
    const sites = useMemo(() => status.data?.sites ?? [], [status.data?.sites]);
    const [selectedSiteUrl, setSelectedSiteUrl] = useState<string | undefined>();
    const setDefaultSite = useSetDefaultSite();
    const { run, busy, error } = useScopedMutation();
    const changeSite = async (url: string) => {
        if (!sites.some(site => site.siteUrl === url)) return;
        const result = await run(async () => {
            const response = await setDefaultSite.mutateAsync(url);
            if (!isRecord(response) || response.success !== true || response.defaultSiteUrl !== url) throw new Error('Site update not acknowledged');
            return url;
        }, 'Could not change the default site. The previous selection remains active.');
        if (result.ok) setSelectedSiteUrl(result.value);
    };

    const activeSiteUrl = useMemo(() => {
        if (selectedSiteUrl && sites.some((s: { siteUrl: string }) => s.siteUrl === selectedSiteUrl)) {
            return selectedSiteUrl;
        }
        const defaultUrl = status.data?.defaultSiteUrl;
        if (defaultUrl && sites.some((s: { siteUrl: string }) => s.siteUrl === defaultUrl)) {
            return defaultUrl;
        }
        return sites[0]?.siteUrl;
    }, [selectedSiteUrl, sites, status.data?.defaultSiteUrl]);

    return (
        <div className="space-y-8">
            {status.error && <p role="alert">Search Console status unavailable. <button type="button" onClick={() => void status.refetch()}>Retry status</button></p>}
            {error && <p role="alert">{error}</p>}
            {/* Hero Header with mesh background */}
            <div className="relative overflow-hidden rounded-xl bg-slate-50       border border-slate-200/60 dark:border-slate-700/40 px-8 py-8">
                {/* Decorative gradient orbs */}
                <div className="absolute -top-20 -right-20 w-64 h-64 bg-[var(--brand-subtle)] rounded-full blur-3xl" />
                <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-[var(--brand-subtle)] rounded-full blur-3xl" />

                <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex flex-col gap-2">
                        <h1 className="text-3xl font-bold tracking-tight text-[var(--brand-text)]">
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
                                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/70 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/40 text-sm font-medium text-slate-700 dark:text-slate-300">
                                    <Globe size={14} className="text-[var(--brand-text)]" />
                                    {prettySiteUrl(sites[0].siteUrl)}
                                </div>
                            ) : (
                                /* Multiple sites: dropdown selector */
                                <div className="relative inline-flex items-center">
                                    <Globe size={14} className="absolute left-3 text-[var(--brand-text)] pointer-events-none z-10" />
                                    <select
                                        id="seo-domain-selector"
                                        aria-label="Search Console property for overview and suggestions"
                                        disabled={busy || !!status.error}
                                        value={activeSiteUrl ?? ''}
                                        onChange={e => {
                                            const url = e.target.value;
                                            void changeSite(url);
                                        }}
                                    className="appearance-none pl-8 pr-8 py-2 rounded-xl bg-white/70 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/40 text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer hover:border-[var(--brand-border)] dark:hover:border-[var(--primary-color)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--focus-color)]"
                                    >
                                        {sites.map((site: { id: string; siteUrl: string }) => (
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
            <div className="flex bg-slate-100/80 dark:bg-slate-800/60 p-1 rounded-xl border border-slate-200/50 dark:border-slate-700/40 w-fit">
                {tabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            type="button"
                            aria-pressed={isActive}
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
            <div key={`${activeTab}:${activeSiteUrl ?? ''}`} className="animate-fade-slide-up">
                {activeTab === 'overview' && (
                    <ErrorBoundary>
                        <SeoKeywordsPanel siteUrl={activeSiteUrl} />
                    </ErrorBoundary>
                )}

                {activeTab === 'tracker' && (
                    <ErrorBoundary>
                        <KeywordTrackerPanel siteUrl={activeSiteUrl} />
                    </ErrorBoundary>
                )}
            </div>
        </div>
    );
}
