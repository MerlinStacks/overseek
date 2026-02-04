/**
 * Implementation Guide Modal
 * 
 * Displays detailed implementation specifications for AI Co-Pilot recommendations.
 * Shows keyword suggestions, budget specs, creative guidelines, and step-by-step instructions.
 */

import { formatCurrency } from '../../utils/format';
import {
    X,
    Clock,
    CheckCircle2,
    FileText,
    ExternalLink,
    TrendingUp,
    Sparkles
} from 'lucide-react';
import { ActionableRecommendation } from '../../types/ActionableTypes';
import { getDifficultyBadge, generateDefaultSteps } from './implementationGuideUtils';
import {
    KeywordsSection,
    BudgetSection,
    TargetProductsSection,
    StructureNotesSection,
    DataSourceNotesSection,
    ImplementationStepsSection
} from './ImplementationGuideSections';

interface ImplementationGuideModalProps {
    isOpen: boolean;
    onClose: () => void;
    recommendation: ActionableRecommendation;
    onApply?: () => void;
}

/**
 * Ad Spec section showing headlines, descriptions, and sitelinks.
 */
function AdSpecSection({ adSpec }: { adSpec: NonNullable<ActionableRecommendation['implementationDetails']>['adSpec'] }) {
    if (!adSpec) return null;

    return (
        <section>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                <Sparkles className="w-5 h-5 text-purple-600" />
                Ad Creative Specification
            </h3>
            <div className="space-y-4">
                {/* Final URL & Display Path */}
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Final URL</p>
                            <p className="text-sm font-medium text-blue-600 break-all">{adSpec.finalUrl}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Display Path</p>
                            <p className="text-sm font-medium text-gray-700">
                                {new URL(adSpec.finalUrl).hostname.replace('www.', '')}/
                                <span className="text-emerald-600">{adSpec.displayPath.join('/')}</span>
                            </p>
                        </div>
                    </div>
                </div>

                {/* Headlines */}
                {adSpec.headlines.length > 0 && (
                    <div>
                        <p className="text-sm font-medium text-gray-600 mb-2">Headlines (RSA - use 3-15)</p>
                        <div className="flex flex-wrap gap-2">
                            {adSpec.headlines.map((h, idx) => (
                                <span key={idx} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-medium border border-indigo-100">
                                    {h}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Descriptions */}
                {adSpec.descriptions.length > 0 && (
                    <div>
                        <p className="text-sm font-medium text-gray-600 mb-2">Descriptions (RSA - use 2-4)</p>
                        <div className="space-y-2">
                            {adSpec.descriptions.map((d, idx) => (
                                <p key={idx} className="px-3 py-2 bg-gray-50 text-gray-700 rounded-lg text-sm border border-gray-200">
                                    {d}
                                </p>
                            ))}
                        </div>
                    </div>
                )}

                {/* Sitelinks */}
                {adSpec.sitelinks && adSpec.sitelinks.length > 0 && (
                    <div>
                        <p className="text-sm font-medium text-gray-600 mb-2">Sitelink Extensions</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {adSpec.sitelinks.map((sl, idx) => (
                                <div key={idx} className="p-3 bg-white rounded-xl border border-gray-200 hover:border-indigo-300 transition-colors">
                                    <p className="font-medium text-indigo-600 mb-1">{sl.text}</p>
                                    {sl.description1 && <p className="text-xs text-gray-500">{sl.description1}</p>}
                                    <p className="text-xs text-blue-500 mt-1 truncate">{sl.finalUrl}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}

/**
 * Legacy creative spec fallback.
 */
function LegacyCreativeSection({ creativeSpec }: { creativeSpec: { headlines: string[]; descriptions: string[] } }) {
    return (
        <section>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                <Sparkles className="w-5 h-5 text-purple-600" />
                Ad Creative Suggestions
            </h3>
            <div className="space-y-4">
                {creativeSpec.headlines.length > 0 && (
                    <div>
                        <p className="text-sm font-medium text-gray-600 mb-2">Headlines</p>
                        <div className="flex flex-wrap gap-2">
                            {creativeSpec.headlines.map((h, idx) => (
                                <span key={idx} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-medium border border-indigo-100">
                                    {h}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
                {creativeSpec.descriptions.length > 0 && (
                    <div>
                        <p className="text-sm font-medium text-gray-600 mb-2">Descriptions</p>
                        <div className="space-y-2">
                            {creativeSpec.descriptions.map((d, idx) => (
                                <p key={idx} className="px-3 py-2 bg-gray-50 text-gray-700 rounded-lg text-sm border border-gray-200">
                                    {d}
                                </p>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}

export function ImplementationGuideModal({
    isOpen,
    onClose,
    recommendation,
    onApply
}: ImplementationGuideModalProps) {
    if (!isOpen) return null;

    const details = recommendation.implementationDetails;
    const defaultSteps = generateDefaultSteps(recommendation);
    const steps = details?.steps || defaultSteps;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-5">
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 rounded-xl bg-white/20">
                                    <FileText className="w-5 h-5 text-white" />
                                </div>
                                <h3 className="text-xl font-bold text-white">Implementation Guide</h3>
                            </div>
                            <p className="text-white/80 text-sm line-clamp-2">
                                {recommendation.headline.replace(/^[^\w]+/, '')}
                            </p>
                        </div>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
                            <X className="w-5 h-5 text-white" />
                        </button>
                    </div>

                    {/* Quick Stats */}
                    <div className="flex items-center gap-4 mt-4">
                        {details?.estimatedTimeMinutes && (
                            <div className="flex items-center gap-1.5 text-white/80 text-sm">
                                <Clock className="w-4 h-4" />
                                <span>~{details.estimatedTimeMinutes} min</span>
                            </div>
                        )}
                        {details?.difficulty && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getDifficultyBadge(details.difficulty).bg} ${getDifficultyBadge(details.difficulty).text}`}>
                                {getDifficultyBadge(details.difficulty).label}
                            </span>
                        )}
                        {recommendation.estimatedImpact?.revenueChange && (
                            <div className="flex items-center gap-1.5 text-emerald-200 text-sm">
                                <TrendingUp className="w-4 h-4" />
                                <span>+{formatCurrency(recommendation.estimatedImpact.revenueChange)}/mo potential</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
                    <div className="space-y-6">
                        {details?.suggestedKeywords && details.suggestedKeywords.length > 0 && (
                            <KeywordsSection keywords={details.suggestedKeywords} />
                        )}

                        {details?.budgetSpec && <BudgetSection budgetSpec={details.budgetSpec} />}

                        {details?.adSpec && <AdSpecSection adSpec={details.adSpec} />}

                        {!details?.adSpec && details?.creativeSpec && (
                            <LegacyCreativeSection creativeSpec={details.creativeSpec} />
                        )}

                        {details?.targetProducts && details.targetProducts.length > 0 && (
                            <TargetProductsSection products={details.targetProducts} />
                        )}

                        {details?.structureNotes && <StructureNotesSection notes={details.structureNotes} />}

                        {details?.dataSourceNotes && (
                            <DataSourceNotesSection notes={details.dataSourceNotes} copySource={details.copySource} />
                        )}

                        <ImplementationStepsSection steps={steps} />
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                    <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors">
                        Close
                    </button>
                    <div className="flex items-center gap-3">
                        <a
                            href={recommendation.platform === 'google' ? 'https://ads.google.com/aw/overview' : 'https://business.facebook.com/adsmanager'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-4 py-2 text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
                        >
                            Open Ads Manager
                            <ExternalLink className="w-4 h-4" />
                        </a>
                        {onApply && (
                            <button
                                onClick={onApply}
                                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors"
                            >
                                <CheckCircle2 className="w-4 h-4" />
                                Apply Now
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
