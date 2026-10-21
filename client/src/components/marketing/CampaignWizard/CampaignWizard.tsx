/**
 * Campaign Wizard
 * 
 * Multi-step guided setup for creating Google Ads campaigns.
 * Guides users through goal selection, product selection, ad copy, and budget.
 */

import { useState, useCallback } from 'react';
import { X, CheckCircle, ArrowRight } from 'lucide-react';
import { WizardStepIndicator } from './WizardStepIndicator';
import { StepGoalType } from './steps/StepGoalType';
import { StepProductSelection } from './steps/StepProductSelection';
import { StepAdCopy } from './steps/StepAdCopy';
import { StepBudgetReview } from './steps/StepBudgetReview';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { Logger } from '../../../utils/logger';
import { useScopedMutation } from '../../../hooks/useScopedMutation';
import { isRecord } from '../../../utils/responseValidation';
import {
    CampaignDraft,
    WIZARD_STEPS,
    validateStep,
    createInitialDraft
} from './types';

interface CampaignWizardProps {
    isOpen: boolean;
    onClose: () => void;
    /** Optional callback when campaign is successfully created */
    onSuccess?: (campaignName: string) => void;
}

/**
 * Campaign Creation Wizard Component
 * 
 * Provides a 4-step guided flow for creating Google Ads campaigns:
 * 1. Goal & Type selection
 * 2. Product selection (optional)
 * 3. Manual ad copy with optional starter templates
 * 4. Budget & final review
 */
export function CampaignWizard(props: CampaignWizardProps) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!props.isOpen) return null;
    if (!token || !currentAccount) return <div role="alert">Select an account before creating a campaign. <button type="button" onClick={props.onClose}>Close</button></div>;
    return <ScopedCampaignWizard key={JSON.stringify([token, currentAccount.id])} {...props} />;
}
function ScopedCampaignWizard({ isOpen, onClose, onSuccess }: CampaignWizardProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [currentStep, setCurrentStep] = useState<number>(WIZARD_STEPS.GOAL);
    const [draft, setDraft] = useState<CampaignDraft>(createInitialDraft);
    const mutation = useScopedMutation(); const loading = mutation.busy;
    const [created, setCreated] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Navigation handlers with validation
    const handleNext = useCallback(() => {
        const validation = validateStep(currentStep, draft);
        if (!validation.isValid) {
            setError(validation.error || 'Please complete all required fields');
            return;
        }
        setError(null);
        setCurrentStep(curr => Math.min(curr + 1, WIZARD_STEPS.TOTAL));
    }, [currentStep, draft]);

    const handleBack = useCallback(() => {
        setError(null);
        setCurrentStep(curr => Math.max(curr - 1, WIZARD_STEPS.GOAL));
    }, []);

    // Reset wizard state when closing
    const handleClose = useCallback(() => {
        if (mutation.isPending()) return;
        setCurrentStep(WIZARD_STEPS.GOAL);
        setDraft(createInitialDraft());
        setError(null);
        onClose();
    }, [onClose, mutation]);

    // Launch campaign via API
    const handleLaunch = useCallback(async () => {
        if (mutation.isPending() || created) return;
        if (!token || !currentAccount) {
            setError('Authentication required');
            return;
        }

        // Final validation
        for (let step = WIZARD_STEPS.GOAL; step <= WIZARD_STEPS.TOTAL; step++) {
            const validation = validateStep(step, draft);
            if (!validation.isValid) {
                setCurrentStep(step);
                setError(validation.error || 'Invalid configuration');
                return;
            }
        }

        setError(null);

        const result = await mutation.run(async signal => {
            const accountResponse = await fetch('/api/ads', { signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount.id } });
            const accounts: unknown = await accountResponse.json();
            const google = Array.isArray(accounts) ? accounts.find(account => isRecord(account) && account.platform === 'GOOGLE') : null;
            if (!accountResponse.ok || !isRecord(google) || typeof google.currency !== 'string' || !/^[A-Z]{3}$/i.test(google.currency)) throw new Error('Google Ads account currency unavailable');
            Logger.info('[CampaignWizard] Launching campaign', {
                name: draft.name,
                type: draft.type
            });

            // Generate keywords from products if none provided
            const keywords = draft.keywords.length > 0
                ? draft.keywords
                : draft.selectedProducts.map(p => ({
                    text: p.name,
                    matchType: 'PHRASE' as const
                }));

            const res = await fetch('/api/ads/create-campaign', {
                signal,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({
                    type: draft.type,
                    name: draft.name,
                    budget: draft.budget,
                    keywords,
                    adCopy: draft.adCopy,
                    productIds: draft.selectedProducts.map(p => p.id)
                })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to create campaign');
            }
            const confirmation: unknown = await res.json();
            if (!isRecord(confirmation) || confirmation.success !== true || typeof confirmation.campaignResource !== 'string' || !confirmation.campaignResource) throw new Error('Invalid campaign confirmation');

        }, 'Could not confirm campaign creation. Check Google Ads before retrying.');
        if (result.ok) {
            setCreated(true);
            try { onSuccess?.(draft.name); onClose(); }
            catch { setError('Campaign created, but the view could not refresh. Check Google Ads; do not launch again.'); }
        }
    }, [token, currentAccount, draft, onSuccess, onClose, mutation, created]);

    // Don't render if not open
    if (!isOpen) return null;

    // Render step content based on current step
    const renderStepContent = () => {
        switch (currentStep) {
            case WIZARD_STEPS.GOAL:
                return <StepGoalType draft={draft} setDraft={setDraft} />;
            case WIZARD_STEPS.PRODUCTS:
                return <StepProductSelection draft={draft} setDraft={setDraft} />;
            case WIZARD_STEPS.AD_COPY:
                return <StepAdCopy draft={draft} setDraft={setDraft} />;
            case WIZARD_STEPS.BUDGET:
                return <StepBudgetReview draft={draft} setDraft={setDraft} />;
            default:
                return null;
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between bg-white z-10">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Create New Campaign</h2>
                        <p className="text-sm text-gray-500">Guided Setup</p>
                    </div>
                    <button
                        type="button" disabled={loading}
                        onClick={handleClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600"
                        aria-label="Close wizard"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Sidebar / Progress */}
                    <div className="w-64 bg-gray-50 border-r border-gray-100 p-6 hidden md:block">
                        <WizardStepIndicator currentStep={currentStep} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-8 relative">
                        {(error || mutation.error) && (
                            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                                {error || mutation.error}
                            </div>
                        )}
                        <fieldset disabled={loading}>{renderStepContent()}</fieldset>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-8 py-5 border-t border-gray-100 bg-white flex justify-between items-center">
                    <button
                        type="button"
                        onClick={handleBack}
                        disabled={loading || currentStep === WIZARD_STEPS.GOAL}
                        className="px-6 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Back
                    </button>

                    {currentStep < WIZARD_STEPS.TOTAL ? (
                        <button
                            type="button"
                            onClick={handleNext}
                            className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                        >
                            Next Step
                            <ArrowRight size={18} />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleLaunch}
                            disabled={loading || created}
                            className="flex items-center gap-2 px-8 py-2.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-all shadow-lg shadow-green-500/30 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Launching...
                                </>
                            ) : (
                                <>
                                    <CheckCircle size={20} />
                                    Launch Campaign
                                </>
                            )}
                        </button>
                    )}
                </div>

            </div>
        </div>
    );
}
