/**
 * Implementation Guide Sections
 * 
 * Reusable section components for the Implementation Guide Modal.
 */

import { useState } from 'react';
import { formatCurrency } from '../../utils/format';
import {
    Search,
    DollarSign,
    Sparkles,
    Tag,
    Zap,
    AlertTriangle,
    Copy,
    Check,
    Wand2,
    Target
} from 'lucide-react';
import type { KeywordSpec, BudgetSpec } from '../../types/ActionableTypes';
import { getMatchTypeBadge, getBidStrategyLabel } from './implementationGuideUtils';

interface KeywordsSectionProps {
    keywords: KeywordSpec[];
}

/**
 * Suggested keywords table with copy functionality.
 */
export function KeywordsSection({ keywords }: KeywordsSectionProps) {
    const [copiedKeyword, setCopiedKeyword] = useState<string | null>(null);

    const copyKeyword = (keyword: string) => {
        navigator.clipboard.writeText(keyword);
        setCopiedKeyword(keyword);
        setTimeout(() => setCopiedKeyword(null), 1500);
    };

    return (
        <section>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                <Search className="w-5 h-5 text-indigo-600" />
                Suggested Keywords
            </h3>
            <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-100 border-b border-gray-200">
                        <tr>
                            <th className="text-left px-4 py-2.5 font-medium text-gray-600">Keyword</th>
                            <th className="text-left px-4 py-2.5 font-medium text-gray-600">Match Type</th>
                            <th className="text-right px-4 py-2.5 font-medium text-gray-600">Suggested CPC</th>
                            <th className="text-right px-4 py-2.5 font-medium text-gray-600">Est. Clicks</th>
                            <th className="px-4 py-2.5"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {keywords.map((kw, idx) => {
                            const badge = getMatchTypeBadge(kw.matchType);
                            return (
                                <tr key={idx} className="hover:bg-white transition-colors">
                                    <td className="px-4 py-3 font-medium text-gray-900">{kw.keyword}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text}`}>
                                            {kw.matchType}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-700">
                                        {formatCurrency(kw.suggestedCpc)}
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-500">
                                        {kw.estimatedClicks ? `~${kw.estimatedClicks}` : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            onClick={() => copyKeyword(kw.keyword)}
                                            className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                                            title="Copy keyword"
                                        >
                                            {copiedKeyword === kw.keyword ? (
                                                <Check className="w-4 h-4 text-emerald-500" />
                                            ) : (
                                                <Copy className="w-4 h-4" />
                                            )}
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

interface BudgetSectionProps {
    budgetSpec: BudgetSpec;
}

/**
 * Budget and bidding strategy display.
 */
export function BudgetSection({ budgetSpec }: BudgetSectionProps) {
    return (
        <section>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                <DollarSign className="w-5 h-5 text-emerald-600" />
                Budget & Bidding
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Daily Budget</p>
                    <p className="text-xl font-bold text-gray-900">{formatCurrency(budgetSpec.dailyBudget)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Bid Strategy</p>
                    <p className="text-lg font-semibold text-gray-900">{getBidStrategyLabel(budgetSpec.bidStrategy)}</p>
                </div>
                {budgetSpec.targetRoas && (
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Target ROAS</p>
                        <p className="text-xl font-bold text-emerald-600">{budgetSpec.targetRoas}x</p>
                    </div>
                )}
                {budgetSpec.targetCpa && (
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Target CPA</p>
                        <p className="text-xl font-bold text-blue-600">{formatCurrency(budgetSpec.targetCpa)}</p>
                    </div>
                )}
                {budgetSpec.maxCpc && (
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Max CPC</p>
                        <p className="text-xl font-bold text-gray-900">{formatCurrency(budgetSpec.maxCpc)}</p>
                    </div>
                )}
            </div>
        </section>
    );
}

interface TargetProductsSectionProps {
    products: Array<{ name: string; sku?: string }>;
}

/**
 * Target products display.
 */
export function TargetProductsSection({ products }: TargetProductsSectionProps) {
    return (
        <section>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                <Tag className="w-5 h-5 text-orange-600" />
                Target Products
            </h3>
            <div className="flex flex-wrap gap-2">
                {products.map((p, idx) => (
                    <span key={idx} className="px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg text-sm font-medium border border-orange-100">
                        {p.name} {p.sku && `(${p.sku})`}
                    </span>
                ))}
            </div>
        </section>
    );
}

interface StructureNotesSectionProps {
    notes: string;
}

/**
 * Campaign structure notes callout.
 */
export function StructureNotesSection({ notes }: StructureNotesSectionProps) {
    return (
        <section className="bg-blue-50 rounded-xl p-4 border border-blue-100">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-blue-800 mb-2">
                <Zap className="w-4 h-4" />
                Campaign Structure Notes
            </h3>
            <p className="text-sm text-blue-700">{notes}</p>
        </section>
    );
}

interface DataSourceNotesSectionProps {
    notes: {
        cpc?: string;
        keywords?: string;
        copy?: string;
    };
    copySource?: 'ai' | 'template';
}

/**
 * Data source attribution notes.
 */
export function DataSourceNotesSection({ notes, copySource }: DataSourceNotesSectionProps) {
    return (
        <section className="bg-amber-50 rounded-xl p-4 border border-amber-200">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800 mb-3">
                <AlertTriangle className="w-4 h-4" />
                Data Source Notes
                {copySource === 'ai' && (
                    <span className="ml-auto flex items-center gap-1 text-xs text-purple-600 font-normal">
                        <Wand2 className="w-3 h-3" />
                        AI Generated
                    </span>
                )}
            </h3>
            <div className="space-y-2 text-sm">
                {notes.cpc && (
                    <div className="flex items-start gap-2">
                        <DollarSign className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        <p className="text-amber-800"><span className="font-medium">CPC:</span> {notes.cpc}</p>
                    </div>
                )}
                {notes.keywords && (
                    <div className="flex items-start gap-2">
                        <Search className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        <p className="text-amber-800"><span className="font-medium">Keywords:</span> {notes.keywords}</p>
                    </div>
                )}
                {notes.copy && (
                    <div className="flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        <p className="text-amber-800"><span className="font-medium">Ad Copy:</span> {notes.copy}</p>
                    </div>
                )}
            </div>
        </section>
    );
}

interface ImplementationStepsSectionProps {
    steps: string[];
}

/**
 * Step-by-step implementation guide.
 */
export function ImplementationStepsSection({ steps }: ImplementationStepsSectionProps) {
    return (
        <section>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                <Target className="w-5 h-5 text-rose-600" />
                Implementation Steps
            </h3>
            <div className="space-y-3">
                {steps.map((step, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold">
                            {idx + 1}
                        </div>
                        <p className="text-gray-700 pt-0.5">{step}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}
