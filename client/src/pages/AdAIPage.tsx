/**
 * AI Co-Pilot Page - Strategic Insight Deck
 *
 * Light mode dashboard with horizontal Strategic Themes and Actionable Changes grid.
 * State management delegated to useAdAI hook.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Sparkles, Calendar, Download, FileText, AlertTriangle } from 'lucide-react';
import { AdContextModal } from '../components/marketing/AdContextModal';
import { AddKeywordModal } from '../components/marketing/AddKeywordModal';
import { RecommendationFeedbackModal } from '../components/marketing/RecommendationFeedbackModal';
import { ScheduleActionModal } from '../components/marketing/ScheduleActionModal';
import { CampaignWizard } from '../components/marketing/CampaignWizard/CampaignWizard';
import { ImplementationGuideModal } from '../components/marketing/ImplementationGuideModal';
import { StrategicThemeCard } from '../components/marketing/StrategicThemeCard';
import { ActionableChangeCard } from '../components/marketing/ActionableChangeCard';
import { useAdAI } from '../hooks/useAdAI';

export function AdAIPage() {
    const navigate = useNavigate();
    const [showContextModal, setShowContextModal] = useState(false);
    const [showCampaignWizard, setShowCampaignWizard] = useState(false);

    const {
        loading, refreshing, error,
        activeTheme, setActiveTheme,
        themes, filteredRecommendations,
        keywordModalOpen, activeKeywordRec, closeKeywordModal,
        feedbackModalOpen, activeFeedbackRec, closeFeedbackModal,
        scheduleModalOpen, activeScheduleRec, closeScheduleModal,
        guideModalOpen, activeGuideRec, openGuideModal, closeGuideModal,
        fetchSuggestions, handleApply, handleKeywordConfirm, handleFeedbackSubmitted, handleScheduleComplete
    } = useAdAI();

    if (loading) {
        return (
            <div className="-m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-gray-50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="w-16 h-16 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Sparkles className="w-6 h-6 text-indigo-600" />
                        </div>
                    </div>
                    <div className="text-center">
                        <p className="text-lg font-semibold text-gray-900">Analyzing Your Campaigns</p>
                        <p className="text-gray-500">Finding revenue opportunities...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="-m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-gray-50">
            {/* Modals */}
            {showContextModal && <AdContextModal isOpen={showContextModal} onClose={() => setShowContextModal(false)} />}
            {showCampaignWizard && <CampaignWizard isOpen={showCampaignWizard} onClose={() => setShowCampaignWizard(false)} />}

            {activeKeywordRec && (
                <AddKeywordModal
                    isOpen={keywordModalOpen}
                    onClose={closeKeywordModal}
                    recommendation={activeKeywordRec}
                    onConfirm={async (d) => { await handleKeywordConfirm(activeKeywordRec, d); closeKeywordModal(); }}
                />
            )}

            {activeFeedbackRec && (
                <RecommendationFeedbackModal
                    isOpen={feedbackModalOpen}
                    onClose={closeFeedbackModal}
                    recommendation={activeFeedbackRec}
                    action="dismiss"
                    onSubmitted={handleFeedbackSubmitted}
                />
            )}

            {activeScheduleRec && (
                <ScheduleActionModal
                    isOpen={scheduleModalOpen}
                    onClose={closeScheduleModal}
                    recommendation={activeScheduleRec}
                    onScheduled={handleScheduleComplete}
                />
            )}

            {activeGuideRec && (
                <ImplementationGuideModal
                    isOpen={guideModalOpen}
                    onClose={closeGuideModal}
                    recommendation={activeGuideRec}
                    onApply={() => { closeGuideModal(); handleApply(activeGuideRec); }}
                />
            )}

            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-6 py-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={() => navigate('/marketing')} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Strategic Insight Deck</h1>
                            <p className="text-gray-500 text-sm">High-level optimization themes for the current billing cycle</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-medium transition-colors">
                            <Calendar className="w-4 h-4" />
                            Last 7 Days
                        </button>
                        <button
                            onClick={() => fetchSuggestions(true)}
                            disabled={refreshing}
                            className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>
            </header>

            {/* Error state */}
            {error && (
                <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 flex items-center gap-3">
                    <AlertTriangle size={20} />
                    <span>{error}</span>
                </div>
            )}

            {/* Strategic Themes Section */}
            {themes.length > 0 && (
                <section className="px-6 py-6">
                    <div className="relative">
                        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
                            {themes.map(theme => (
                                <StrategicThemeCard
                                    key={theme.id}
                                    theme={theme}
                                    isActive={activeTheme === theme.id}
                                    onClick={() => setActiveTheme(activeTheme === theme.id ? null : theme.id)}
                                />
                            ))}
                        </div>
                    </div>
                </section>
            )}

            {/* Actionable Changes Section */}
            <section className="px-6 pb-8">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-bold text-gray-900">Actionable Changes</h2>
                        <span className="px-2.5 py-1 rounded-full bg-gray-200 text-gray-600 text-sm font-medium">
                            {filteredRecommendations.length} PENDING
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-2 px-3 py-1.5 text-gray-600 hover:text-gray-900 font-medium transition-colors">
                            <Download className="w-4 h-4" />
                            Export CSV
                        </button>
                        <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors">
                            <FileText className="w-4 h-4" />
                            Implementation Log
                        </button>
                    </div>
                </div>

                {filteredRecommendations.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredRecommendations.map(rec => (
                            <ActionableChangeCard
                                key={rec.id}
                                recommendation={rec}
                                onImplementationGuide={() => openGuideModal(rec)}
                                onApply={() => handleApply(rec)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
                        <div className="w-16 h-16 rounded-full bg-gray-100 mx-auto mb-4 flex items-center justify-center">
                            <Sparkles className="w-8 h-8 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            {activeTheme ? 'No recommendations in this category' : 'No recommendations available'}
                        </h3>
                        <p className="text-gray-500 mb-4">
                            {activeTheme ? 'Try selecting a different theme or clear the filter.' : "We'll analyze your campaigns and surface opportunities here."}
                        </p>
                        {activeTheme && (
                            <button onClick={() => setActiveTheme(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors">
                                Clear Filter
                            </button>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}
