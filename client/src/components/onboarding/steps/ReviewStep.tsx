/**
 * Review Step
 * 
 * Final step in onboarding: Review configured integrations and launch.
 * Shows summary of completed/skipped steps with ability to go back.
 */

import React from 'react';
import { CheckCircle, SkipForward, ArrowLeft, Rocket, Store, Plug, Mail, TrendingUp, AlertCircle } from 'lucide-react';
import { OnboardingStepProps, ONBOARDING_STEPS } from '../types';
import { useAccount } from '../../../context/AccountContext';
import { Metric, MetricStrip } from '../../ui/MetricStrip';

interface IntegrationStatus {
    step: number;
    label: string;
    icon: React.ElementType;
    isCompleted: boolean;
    isSkipped: boolean;
    details?: string;
}

/**
 * Shows a summary of all configured integrations and allows final confirmation.
 */
export function ReviewStep({ draft, setDraft: _setDraft, onNext, onBack, isSubmitting }: OnboardingStepProps) {
    const { currentAccount } = useAccount();
    const storeReady = !!currentAccount?.id && draft.store.connectionVerified && draft.store.accountId === currentAccount.id;
    // Build integration status list
    const integrations: IntegrationStatus[] = [
        {
            step: ONBOARDING_STEPS.STORE,
            label: 'WooCommerce Store',
            icon: Store,
            isCompleted: storeReady,
            isSkipped: false,
            details: draft.store.name || undefined
        },
        {
            step: ONBOARDING_STEPS.PLUGIN,
            label: 'OverSeek Plugin',
            icon: Plug,
            isCompleted: storeReady && draft.plugin.verified && !draft.skippedSteps.includes(ONBOARDING_STEPS.PLUGIN),
            isSkipped: draft.skippedSteps.includes(ONBOARDING_STEPS.PLUGIN),
            details: draft.plugin.verified ? `v${draft.plugin.pluginVersion || 'Installed'}` : undefined
        },
        {
            step: ONBOARDING_STEPS.EMAIL,
            label: 'Email (SMTP)',
            icon: Mail,
            isCompleted: storeReady && draft.email.enabled && !!draft.email.configured && !!draft.email.savedEmailId && draft.email.verifiedAccountId === currentAccount?.id && !draft.skippedSteps.includes(ONBOARDING_STEPS.EMAIL),
            isSkipped: draft.skippedSteps.includes(ONBOARDING_STEPS.EMAIL) || !draft.email.enabled,
            details: draft.email.configured ? draft.email.email : draft.email.verified ? 'Connection tested only; configuration not saved' : undefined
        },
        {
            step: ONBOARDING_STEPS.ADS,
            label: 'Ad Accounts',
            icon: TrendingUp,
            isCompleted: storeReady && !draft.skippedSteps.includes(ONBOARDING_STEPS.ADS) && (draft.ads.googleConnected || draft.ads.metaConnected),
            isSkipped: draft.skippedSteps.includes(ONBOARDING_STEPS.ADS),
            details: [
                draft.ads.googleConnected ? 'Google Ads' : null,
                draft.ads.metaConnected ? 'Meta Ads' : null
            ].filter(Boolean).join(', ') || undefined
        }
    ];

    const completedCount = integrations.filter(i => i.isCompleted).length;
    const skippedCount = integrations.filter(i => i.isSkipped && !i.isCompleted).length;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center pb-4 border-b border-gray-100">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-[var(--brand-subtle)] text-[var(--brand-text)] mb-4">
                    <Rocket size={32} />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Review Setup</h2>
                <p className="text-gray-500 mt-2">
                    Review your setup and start using OverSeek
                </p>
            </div>

            {/* Summary Stats */}
            <MetricStrip label="Integration setup summary" className="grid-cols-2">
                <Metric label="Integrations Ready" value={completedCount} valueClassName="text-green-700 dark:text-green-300" />
                <Metric label="Skipped (Optional)" value={skippedCount} valueClassName="text-amber-700 dark:text-amber-300" />
            </MetricStrip>

            {/* Integration List */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Your Setup</h3>

                {integrations.map((integration) => {
                    const Icon = integration.icon;

                    return (
                        <div
                            key={integration.step}
                            className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${integration.isCompleted
                                ? 'bg-green-50 border-green-200'
                                : integration.isSkipped
                                    ? 'bg-amber-50 border-amber-200'
                                    : 'bg-gray-50 border-gray-200'
                                }`}
                        >
                            {/* Status Icon */}
                            <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${integration.isCompleted
                                ? 'bg-green-100 text-green-600'
                                : integration.isSkipped
                                    ? 'bg-amber-100 text-amber-600'
                                    : 'bg-gray-100 text-gray-400'
                                }`}>
                                {integration.isCompleted ? (
                                    <CheckCircle size={20} />
                                ) : integration.isSkipped ? (
                                    <SkipForward size={18} />
                                ) : (
                                    <Icon size={20} />
                                )}
                            </div>

                            {/* Label & Details */}
                            <div className="flex-1 min-w-0">
                                <div className={`text-sm font-semibold ${integration.isCompleted ? 'text-green-800' :
                                    integration.isSkipped ? 'text-amber-800' :
                                        'text-gray-600'
                                    }`}>
                                    {integration.label}
                                </div>
                                {integration.details && (
                                    <div className="text-xs text-gray-500 truncate mt-0.5">
                                        {integration.details}
                                    </div>
                                )}
                            </div>

                            {/* Status Badge */}
                            <div className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${integration.isCompleted
                                ? 'bg-green-100 text-green-700'
                                : integration.isSkipped
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-gray-100 text-gray-500'
                                }`}>
                                {integration.isCompleted ? 'Ready' : integration.isSkipped ? 'Skipped' : 'Pending'}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Skipped Items Notice */}
            {skippedCount > 0 && (
                <div className="bg-[var(--brand-subtle)] border border-[var(--brand-border)] rounded-lg p-4 flex gap-3">
                    <AlertCircle className="w-5 h-5 text-[var(--brand-text)] flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-[var(--brand-text)]">
                        <p className="font-medium">Some integrations were skipped</p>
                        <p className="mt-1 opacity-90">
                            You can complete these from Settings. Features that depend on skipped integrations remain unavailable until configured.
                        </p>
                    </div>
                </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <button
                    type="button"
                    onClick={onBack}
                    disabled={isSubmitting}
                    className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors font-medium"
                >
                    <ArrowLeft size={18} />
                    Back
                </button>

                <button
                    type="button"
                    onClick={onNext}
                    disabled={isSubmitting || !storeReady}
                    className="flex items-center gap-2 px-6 py-3 bg-[var(--primary-color)] text-[var(--primary-foreground)] rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors font-semibold focus-visible:outline-[var(--focus-color)]"
                >
                    {isSubmitting ? (
                        <>
                            <span className="animate-spin">⏳</span>
                            Completing Setup...
                        </>
                    ) : (
                        <>
                            <Rocket size={18} />
                            Complete Setup
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
