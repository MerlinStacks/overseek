/**
 * Setup Wizard
 * 
 * Multi-step onboarding wizard for new account creation.
 * Guides users through store connection, plugin setup, email, and ad accounts.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Logger } from '../utils/logger';

// Onboarding components
import { OnboardingStepIndicator } from '../components/onboarding/OnboardingStepIndicator';
import { StoreStep, PluginStep, EmailStep, AdsStep, ReviewStep } from '../components/onboarding/steps';
import {
    ONBOARDING_STEPS,
    STEP_CONFIG,
    OnboardingDraft,
    createInitialDraft,
    validateStep,
    saveDraftToStorage,
    loadDraftFromStorage,
    clearDraftFromStorage
} from '../components/onboarding/types';

/**
 * Multi-step setup wizard orchestrator.
 * Manages step navigation, validation, persistence, and account creation.
 */
export function SetupWizard() {
    // State - use explicit number type for step to allow any step value
    const [currentStep, setCurrentStep] = useState<number>(ONBOARDING_STEPS.STORE);
    const [draft, setDraft] = useState<OnboardingDraft>(createInitialDraft);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Hooks
    const { token, logout, isLoading: authLoading } = useAuth();
    const { refreshAccounts, accounts, isLoading: accountsLoading, currentAccount } = useAccount();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const isAddingNew = searchParams.get('addNew') === 'true';

    // ─────────────────────────────────────────────────────────────────────────
    // Effects
    // ─────────────────────────────────────────────────────────────────────────

    // Redirect to login if not authenticated
    useEffect(() => {
        if (!authLoading && !token) {
            navigate('/login', { replace: true });
        }
    }, [authLoading, token, navigate]);

    // Redirect to dashboard if user already has accounts (unless adding new)
    useEffect(() => {
        if (!accountsLoading && accounts.length > 0 && !isAddingNew) {
            Logger.debug('SetupWizard: User has accounts, redirecting to dashboard');
            navigate('/');
        }
    }, [accounts, accountsLoading, navigate, isAddingNew]);

    // Load saved draft from localStorage on mount
    useEffect(() => {
        const saved = loadDraftFromStorage();
        if (saved && !isAddingNew) {
            Logger.debug('SetupWizard: Resuming from saved draft', { step: saved.currentStep });
            setDraft(saved.draft);
            setCurrentStep(saved.currentStep);
        }
    }, [isAddingNew]);

    // Save draft to localStorage on changes
    useEffect(() => {
        if (draft.store.name || draft.completedSteps.length > 0) {
            saveDraftToStorage(draft, currentStep);
        }
    }, [draft, currentStep]);

    // ─────────────────────────────────────────────────────────────────────────
    // Navigation Handlers
    // ─────────────────────────────────────────────────────────────────────────

    const handleNext = useCallback(() => {
        // Validate current step
        const validation = validateStep(currentStep, draft);
        if (!validation.isValid) {
            setError(validation.error || 'Please complete all required fields');
            return;
        }

        setError(null);

        // Mark current step as completed
        if (!draft.completedSteps.includes(currentStep)) {
            setDraft(prev => ({
                ...prev,
                completedSteps: [...prev.completedSteps, currentStep]
            }));
        }

        // Move to next step or finalize
        if (currentStep < ONBOARDING_STEPS.TOTAL) {
            setCurrentStep(prev => prev + 1);
        } else {
            handleFinalize();
        }
    }, [currentStep, draft]);

    const handleBack = useCallback(() => {
        if (currentStep > ONBOARDING_STEPS.STORE) {
            setCurrentStep(prev => prev - 1);
            setError(null);
        }
    }, [currentStep]);

    const handleSkip = useCallback(() => {
        // Mark step as skipped (only for skippable steps)
        const stepConfig = STEP_CONFIG.find(s => s.id === currentStep);
        if (stepConfig?.skippable) {
            if (!draft.skippedSteps.includes(currentStep)) {
                setDraft(prev => ({
                    ...prev,
                    skippedSteps: [...prev.skippedSteps, currentStep]
                }));
            }
        }

        setError(null);

        // Move to next step
        if (currentStep < ONBOARDING_STEPS.TOTAL) {
            setCurrentStep(prev => prev + 1);
        }
    }, [currentStep, draft]);

    // ─────────────────────────────────────────────────────────────────────────
    // Finalization
    // ─────────────────────────────────────────────────────────────────────────

    const handleFinalize = useCallback(async () => {
        setIsSubmitting(true);
        setError(null);

        try {
            // Check if account was already created in StoreStep
            if (currentAccount?.id) {
                // Account exists - just update additional settings if needed
                Logger.info('SetupWizard: Account already exists, skipping creation', { accountId: currentAccount.id });

                // Could add PATCH to update email/ads settings here if needed
                // For now, just clear draft and navigate
                clearDraftFromStorage();
                await refreshAccounts();
                navigate('/');
                return;
            }

            // Fallback: Create account if it wasn't created in StoreStep
            // This handles edge cases where early creation failed
            const res = await fetch('/api/accounts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: draft.store.name,
                    domain: draft.store.domain || draft.store.wooUrl,
                    wooUrl: draft.store.wooUrl,
                    wooConsumerKey: draft.store.wooConsumerKey,
                    wooConsumerSecret: draft.store.wooConsumerSecret,
                    // Optional fields based on what was configured
                    pluginVerified: draft.plugin.verified,
                    emailConfigured: draft.email.enabled && draft.email.verified,
                    adsConfigured: draft.ads.googleConnected || draft.ads.metaConnected
                })
            });

            if (res.status === 401) {
                logout();
                return;
            }

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to create account');
            }

            // Clear saved draft
            clearDraftFromStorage();

            // Refresh accounts and navigate
            await refreshAccounts();
            navigate('/');
        } catch (err) {
            Logger.error('SetupWizard: Account creation failed', { error: err });
            setError(err instanceof Error ? err.message : 'Failed to create account');
        } finally {
            setIsSubmitting(false);
        }
    }, [draft, token, logout, refreshAccounts, navigate, currentAccount]);

    // ─────────────────────────────────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────────────────────────────────

    // Loading state
    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-500">Loading...</p>
                </div>
            </div>
        );
    }

    // Not authenticated
    if (!token) {
        return null;
    }

    // Step props passed to all step components
    const stepProps = {
        draft,
        setDraft,
        onNext: handleNext,
        onBack: handleBack,
        onSkip: handleSkip,
        isSubmitting
    };

    // Render current step content
    const renderStep = () => {
        switch (currentStep) {
            case ONBOARDING_STEPS.STORE:
                return <StoreStep {...stepProps} />;
            case ONBOARDING_STEPS.PLUGIN:
                return <PluginStep {...stepProps} />;
            case ONBOARDING_STEPS.EMAIL:
                return <EmailStep {...stepProps} />;
            case ONBOARDING_STEPS.ADS:
                return <AdsStep {...stepProps} />;
            case ONBOARDING_STEPS.REVIEW:
                return <ReviewStep {...stepProps} />;
            default:
                return <StoreStep {...stepProps} />;
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
            <div className="max-w-6xl mx-auto px-4 py-8">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">
                        {isAddingNew ? 'Add New Store' : 'Welcome to OverSeek'}
                    </h1>
                    <p className="text-gray-500 mt-2">
                        {isAddingNew
                            ? 'Connect another WooCommerce store to your account'
                            : "Let's get your store set up in just a few steps"
                        }
                    </p>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                        {error}
                    </div>
                )}

                {/* Main Layout */}
                <div className="flex gap-8">
                    {/* Left Sidebar - Step Indicator */}
                    <div className="hidden md:block w-64 flex-shrink-0">
                        <div className="sticky top-8 bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                            <OnboardingStepIndicator
                                currentStep={currentStep}
                                completedSteps={draft.completedSteps}
                                skippedSteps={draft.skippedSteps}
                            />
                        </div>
                    </div>

                    {/* Right Content - Step Form */}
                    <div className="flex-1 min-w-0">
                        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                            <div className="p-6 md:p-8">
                                {renderStep()}
                            </div>
                        </div>

                        {/* Mobile Step Indicator */}
                        <div className="md:hidden mt-6 flex justify-center gap-2">
                            {STEP_CONFIG.map((step) => (
                                <div
                                    key={step.id}
                                    className={`w-2.5 h-2.5 rounded-full transition-colors ${step.id === currentStep
                                        ? 'bg-blue-600'
                                        : draft.completedSteps.includes(step.id)
                                            ? 'bg-green-500'
                                            : draft.skippedSteps.includes(step.id)
                                                ? 'bg-amber-400'
                                                : 'bg-gray-300'
                                        }`}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
