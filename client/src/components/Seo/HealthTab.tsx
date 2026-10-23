/**
 * HealthTab — Cannibalization detection + AI content briefs.
 */

import { useState } from 'react';
import {
    ShieldCheck, AlertTriangle, Loader2, FileText,
    ChevronDown, ChevronUp, Sparkles, ExternalLink
} from 'lucide-react';
import { useCannibalization, useContentBrief } from '../../hooks/useSeoKeywords';
import type { ContentBrief, CannibalizationResult } from '../../hooks/useSeoKeywords';
import { getSafeHref } from '../../utils/url';

const SEVERITY_STYLES = {
    high: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50',
    medium: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800/50',
    low: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800/50',
} as const;

export function HealthTab() {
    const { data: cannData, isLoading: cannLoading, error: cannError, refetch: reloadCannibalization } = useCannibalization();
    const contentBrief = useContentBrief();
    const [expandedKw, setExpandedKw] = useState<string | null>(null);
    const [activeBrief, setActiveBrief] = useState<ContentBrief | null>(null);
    const [briefInput, setBriefInput] = useState('');

    const cannResults = cannData?.keywords || [];

    const handleBrief = async (keyword: string) => {
        setBriefInput(keyword);
        try {
            const b = await contentBrief.mutateAsync({ keyword });
            setActiveBrief(b);
        } catch { /* mutation state handles errors */ }
    };

    return (
        <div className="space-y-8 animate-fade-slide-up">
            {/* Cannibalization */}
            <section className="space-y-4">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-[var(--brand-text)]" />
                        Cannibalization Detection
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Keywords where multiple pages compete</p>
                </div>

                {cannLoading ? (
                    <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
                ) : cannError ? (
                    <div role="alert">Could not complete cannibalization analysis. Existing findings were preserved. <button type="button" onClick={() => void reloadCannibalization()}>Retry analysis</button></div>
                ) : cannResults.length === 0 ? (
                    <div className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 rounded-xl text-center py-14 px-6">
                        <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                        <p className="text-sm text-slate-500 dark:text-slate-400">No cannibalization detected!</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {cannResults.map((r: CannibalizationResult) => (
                            <div key={r.keyword} className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 rounded-xl overflow-hidden">
                                <button onClick={() => setExpandedKw(expandedKw === r.keyword ? null : r.keyword)}
                                    className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md border ${SEVERITY_STYLES[r.severity]}`}>{r.severity}</span>
                                        <span className="font-medium text-sm text-slate-900 dark:text-slate-200">{r.keyword}</span>
                                        <span className="text-xs text-slate-400">{r.pages.length} pages</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button onClick={(e) => { e.stopPropagation(); handleBrief(r.keyword); }}
                                            className="flex items-center gap-1 px-2.5 py-1 text-xs text-[var(--brand-text)] bg-[var(--brand-subtle)] rounded-lg hover:bg-[var(--brand-subtle)] font-medium">
                                            <Sparkles className="w-3 h-3" /> Brief
                                        </button>
                                        {expandedKw === r.keyword ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                                    </div>
                                </button>
                                {expandedKw === r.keyword && (
                                    <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-slate-700/50 pt-3 animate-fade-slide-up">
                                        <p className="text-xs text-slate-500 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" />{r.recommendation}</p>
                                        {r.pages.map(p => (
                                            <div key={p.url} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-lg px-3 py-2 text-xs">
                                                <a href={getSafeHref(p.url)} target="_blank" rel="noopener noreferrer" className="text-[var(--brand-text)] hover:underline truncate max-w-[50%] flex items-center gap-1">
                                                    {p.url.replace(/^https?:\/\/[^/]+/, '')}<ExternalLink className="w-3 h-3 shrink-0" />
                                                </a>
                                                <div className="flex items-center gap-4 text-slate-500">
                                                    <span>#{Math.round(p.position)}</span>
                                                    <span>{p.clicks} clicks</span>
                                                    <span>{p.impressions.toLocaleString()} imp</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Content Brief */}
            <section className="space-y-4">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <FileText className="w-5 h-5 text-[var(--brand-text)]" /> AI Content Brief
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Generate an AI-powered content strategy</p>
                </div>
                <div className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 rounded-xl p-4 flex items-center gap-3">
                    <Sparkles className="w-4 h-4 text-[var(--brand-text)] shrink-0" />
                    <input type="text" placeholder="Enter a keyword..." value={briefInput}
                        onChange={(e) => setBriefInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && briefInput && handleBrief(briefInput)}
                        className="input-premium flex-1 bg-transparent text-sm" />
                    <button onClick={() => briefInput && handleBrief(briefInput)}
                        disabled={!briefInput?.trim() || contentBrief.isPending}
                        className="px-4 py-1.5 text-sm bg-[var(--primary-color)] text-[var(--primary-foreground)] rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors font-medium">
                        {contentBrief.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Generate'}
                    </button>
                </div>

                {activeBrief && (
                    <div className="border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 rounded-xl p-6 space-y-5 animate-fade-slide-up">
                        <p className="text-xs text-slate-500">{activeBrief.provenance === 'ai' ? 'AI-generated draft. Verify facts and links before publishing.' : 'Template outline, not AI-generated. Verify facts and links before publishing.'}</p>
                        <div className="flex items-center justify-between">
                            <h4 className="font-semibold text-slate-900 dark:text-slate-100">Brief: <span className="text-[var(--brand-text)]">{activeBrief.keyword}</span></h4>
                            <div className="flex gap-2 text-xs text-slate-400">
                                <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded capitalize">{activeBrief.brief.contentType}</span>
                                <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded capitalize">{activeBrief.brief.tone}</span>
                                <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">{activeBrief.brief.wordCount} words</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-3">
                                <div><p className="text-xs font-medium text-slate-500 mb-1">Suggested Title</p><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{activeBrief.brief.suggestedTitle}</p></div>
                                <div><p className="text-xs font-medium text-slate-500 mb-1">Meta Description</p><p className="text-sm text-slate-700 dark:text-slate-300">{activeBrief.brief.metaDescription}</p></div>
                            </div>
                            <div><p className="text-xs font-medium text-slate-500 mb-1">Heading Outline</p>
                                <ul className="space-y-1">{activeBrief.brief.headingOutline.map((h, i) => (
                                    <li key={i} className="text-sm text-slate-700 dark:text-slate-300"><span className="text-[var(--brand-text)] font-mono text-xs mr-1.5">{i + 1}.</span>{h}</li>
                                ))}</ul>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-700/50">
                            <div><p className="text-xs font-medium text-slate-500 mb-2">Key Topics</p>
                                <div className="flex flex-wrap gap-1.5">{activeBrief.brief.keyTopics.map(t => (
                                    <span key={t} className="px-2 py-0.5 text-xs bg-[var(--brand-subtle)] text-[var(--brand-text)] rounded border border-[var(--brand-border)]">{t}</span>
                                ))}</div>
                            </div>
                            <div><p className="text-xs font-medium text-slate-500 mb-2">Internal Links</p>
                                <ul className="space-y-1">{activeBrief.brief.internalLinkSuggestions.map((l, i) => (
                                    <li key={i} className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5"><ExternalLink className="w-3 h-3 text-slate-400" />{l}</li>
                                ))}</ul>
                            </div>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
