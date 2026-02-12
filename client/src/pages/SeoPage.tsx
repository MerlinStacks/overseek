/**
 * SeoPage — Standalone page for SEO keyword insights and tracking.
 *
 * Premium design: gradient header, glass pill tabs, animated tab content.
 * Why a separate page: SEO tracking has enough depth to warrant its own
 * space separate from the Marketing hub.
 */

import { useState } from 'react';
import { Target, TrendingUp } from 'lucide-react';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { SeoKeywordsPanel } from '../components/Seo/SeoKeywordsPanel';
import { KeywordTrackerPanel } from '../components/Seo/KeywordTrackerPanel';

type TabId = 'overview' | 'tracker';

const tabs = [
    { id: 'overview' as TabId, label: 'SEO Overview', icon: Target },
    { id: 'tracker' as TabId, label: 'Keyword Tracker', icon: TrendingUp },
];

export function SeoPage() {
    const [activeTab, setActiveTab] = useState<TabId>('overview');

    return (
        <div className="space-y-8">
            {/* Hero Header with mesh background */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 via-blue-50/50 to-violet-50/30 dark:from-slate-900 dark:via-blue-950/30 dark:to-violet-950/20 border border-slate-200/60 dark:border-slate-700/40 px-8 py-8">
                {/* Decorative gradient orbs */}
                <div className="absolute -top-20 -right-20 w-64 h-64 bg-blue-400/10 dark:bg-blue-500/5 rounded-full blur-3xl" />
                <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-violet-400/10 dark:bg-violet-500/5 rounded-full blur-3xl" />

                <div className="relative z-10 flex flex-col gap-2">
                    <h1 className="text-3xl font-bold tracking-tight text-gradient">
                        SEO & Organic Search
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 max-w-lg">
                        Monitor organic search performance, track keyword rankings, and discover growth opportunities.
                    </p>
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
                        <SeoKeywordsPanel />
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
