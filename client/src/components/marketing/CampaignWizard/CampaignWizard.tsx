/**
 * Campaign Wizard
 * 
 * Multi-step modal for creating Google Ads campaigns with AI assistance.
 * Guides users through goal selection, product selection, ad copy, and budget.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { X, CheckCircle, ArrowRight } from 'lucide-react';
import { WizardStepIndicator } from './WizardStepIndicator';
import { StepGoalType } from './steps/StepGoalType';
import { StepProductSelection } from './steps/StepProductSelection';
import { StepAdCopy } from './steps/StepAdCopy';
import { StepBudgetReview } from './steps/StepBudgetReview';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { Logger } from '../../../utils/logger';
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
 * 3. AI-generated ad copy (editable)
 * 4. Budget & final review
 */
export function CampaignWizard({ isOpen, onClose, onSuccess }: CampaignWizardProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [currentStep, setCurrentStep] = useState<number>(WIZARD_STEPS.GOAL);
    const [draft, setDraft] = useState<CampaignDraft>(createInitialDraft);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Memoized validation for current step
    const stepValidation = useMemo(
        () => validateStep(currentStep, draft),
        [currentStep, draft]
    );

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
        setCurrentStep(WIZARD_STEPS.GOAL);
        setDraft(createInitialDraft());
        setError(null);
        onClose();
    }, [onClose]);

    // Launch campaign via API
    const handleLaunch = useCallback(async () => {
        if (!token || !currentAccount) {
            setError('Authentication required');
            return;
        }

        // Final validation
        const validation = validateStep(WIZARD_STEPS.BUDGET, draft);
        if (!validation.isValid) {
            setError(validation.error || 'Invalid configuration');
            return;
        }

        setLoading(true);
        setError(null);

        try {
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

            Logger.info('[CampaignWizard] Campaign created successfully', { name: draft.name });
            onSuccess?.(draft.name);
            handleClose();

        } catch (e: any) {
            Logger.error('[CampaignWizard] Failed to launch campaign', { error: e.message });
            setError(e.message || 'An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    }, [token, currentAccount, draft, onSuccess, handleClose]);

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
                        <p className="text-sm text-gray-500">AI-Powered Setup</p>
                    </div>
                    <button
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
                        {error && (
                            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                                {error}
                            </div>
                        )}
                        {renderStepContent()}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-8 py-5 border-t border-gray-100 bg-white flex justify-between items-center">
                    <button
                        onClick={handleBack}
                        disabled={currentStep === WIZARD_STEPS.GOAL}
                        className="px-6 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Back
                    </button>

                    {currentStep < WIZARD_STEPS.TOTAL ? (
                        <button
                            onClick={handleNext}
                            className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                        >
                            Next Step
                            <ArrowRight size={18} />
                        </button>
                    ) : (
                        <button
                            onClick={handleLaunch}
                            disabled={loading}
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
