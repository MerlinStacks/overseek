/**
 * Setup Wizard
 * 
 * Multi-step onboarding wizard for new account creation.
 * Guides users through store connection, plugin setup, email, and ad accounts.
 */

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Logger } from '../utils/logger';
import { useScopedMutation } from '../hooks/useScopedMutation';

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
    const { user, token, isLoading } = useAuth();
    const [params] = useSearchParams();
    if (isLoading) return <p role="status">Loading setup...</p>;
    if (!user || !token) return <Navigate to="/login" replace />;
    return <SetupWizardContent key={JSON.stringify([user.id, token, params.get('addNew') === 'true'])} userId={user.id} />;
}

function SetupWizardContent({ userId }: { userId: string }) {
    // State - use explicit number type for step to allow any step value
    const [currentStep, setCurrentStep] = useState<number>(ONBOARDING_STEPS.STORE);
    const [draft, setDraft] = useState<OnboardingDraft>(createInitialDraft);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const finalize = useScopedMutation();
    const [error, setError] = useState<string | null>(null);
    const [draftLoaded, setDraftLoaded] = useState(false);
    // Tracks whether an account was created within this wizard session,
    // so the redirect-to-dashboard guard doesn't fire prematurely.
    const createdInSession = useRef(false);

    // Hooks
    const { token, isLoading: authLoading } = useAuth();
    const { refreshAccounts, accounts, isLoading: accountsLoading, currentAccount } = useAccount();
    const activeAccountId = useRef(currentAccount?.id); useLayoutEffect(() => { activeAccountId.current = currentAccount?.id; }, [currentAccount?.id]);
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

    // Mark this as a wizard-created session only after store/account creation
    // has been successfully verified in this flow.
    useEffect(() => {
        if (draft.store.connectionVerified && draft.store.accountId === currentAccount?.id) {
            createdInSession.current = true;
        }
    }, [draft.store.connectionVerified, draft.store.accountId, currentAccount?.id]);

    // Redirect to dashboard if user already has accounts (unless adding new
    // or the account was just created within this wizard session).
    useEffect(() => {
        if (draftLoaded && !accountsLoading && accounts.length > 0 && !isAddingNew && !createdInSession.current) {
            Logger.debug('SetupWizard: User has accounts, redirecting to dashboard');
            navigate('/dashboard');
        }
    }, [accounts, accountsLoading, navigate, isAddingNew, draftLoaded]);

    // Load saved draft from localStorage on mount
    useEffect(() => {
        if (accountsLoading || draftLoaded) return;
        let disposed = false;
        queueMicrotask(() => {
            if (disposed) return;
            const saved = loadDraftFromStorage({ userId, mode: isAddingNew ? 'add' : 'setup', accountId: currentAccount?.id });
            if (saved && !isAddingNew) {
                Logger.debug('SetupWizard: Resuming from saved draft', { step: saved.currentStep });
                setDraft(saved.draft);
                setCurrentStep(saved.currentStep);
                // Preserve wizard-created session only for the matching account.
                if (saved.wizardSessionActive && saved.draft.store.connectionVerified) {
                    createdInSession.current = true;
                }
            }
            setDraftLoaded(true);
        });
        return () => { disposed = true; };
    }, [isAddingNew, userId, currentAccount?.id, accountsLoading, draftLoaded]);

    // Save draft to localStorage on changes
    useEffect(() => {
        if (draftLoaded && (draft.store.name || draft.completedSteps.length > 0)) {
            saveDraftToStorage(draft, currentStep, { userId, mode: isAddingNew ? 'add' : 'setup', accountId: currentAccount?.id });
        }
    }, [draft, currentStep, userId, isAddingNew, currentAccount?.id, draftLoaded]);

    // ─────────────────────────────────────────────────────────────────────────
    // Navigation Handlers
    // ─────────────────────────────────────────────────────────────────────────

    const handleNext = () => {
        if (finalize.isPending()) return;
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
                completedSteps: [...prev.completedSteps, currentStep], skippedSteps: prev.skippedSteps.filter(step => step !== currentStep)
            }));
        }

        // Move to next step or finalize
        if (currentStep < ONBOARDING_STEPS.TOTAL) {
            setCurrentStep(prev => prev + 1);
        } else {
            void handleFinalize();
        }
    };

    const handleBack = useCallback(() => {
        if (finalize.isPending()) return;
        if (currentStep > ONBOARDING_STEPS.STORE) {
            setCurrentStep(prev => prev - 1);
            setError(null);
        }
    }, [currentStep, finalize]);

    const handleSkip = useCallback(() => {
        if (finalize.isPending()) return;
        // Mark step as skipped (only for skippable steps)
        const stepConfig = STEP_CONFIG.find(s => s.id === currentStep);
        if (stepConfig?.skippable) {
            if (!draft.skippedSteps.includes(currentStep)) {
                setDraft(prev => ({
                    ...prev,
                    skippedSteps: [...prev.skippedSteps, currentStep], completedSteps: prev.completedSteps.filter(step => step !== currentStep)
                }));
            }
        }

        setError(null);

        // Move to next step
        if (currentStep < ONBOARDING_STEPS.TOTAL) {
            setCurrentStep(prev => prev + 1);
        }
    }, [currentStep, draft, finalize]);

    /** Navigate directly to a previously completed or skipped step */
    const goToStep = useCallback((stepId: number) => {
        if (finalize.isPending()) return;
        // Only allow navigating to completed, skipped, or the current step
        const canNavigate = draft.completedSteps.includes(stepId)
            || draft.skippedSteps.includes(stepId)
            || stepId === currentStep;
        if (canNavigate && stepId >= ONBOARDING_STEPS.STORE && stepId <= ONBOARDING_STEPS.TOTAL) {
            setCurrentStep(stepId);
            setError(null);
        }
    }, [draft.completedSteps, draft.skippedSteps, currentStep, finalize]);

    // ─────────────────────────────────────────────────────────────────────────
    // Finalization
    // ─────────────────────────────────────────────────────────────────────────

    const handleFinalize = useCallback(async () => {
        if (finalize.isPending()) return;
        if (!draft.store.connectionVerified || !currentAccount?.id || draft.store.accountId !== currentAccount.id) { setError('Verify this store account before completing setup.'); return; }
        if (!draft.skippedSteps.includes(ONBOARDING_STEPS.EMAIL)) {
            const validation = validateStep(ONBOARDING_STEPS.EMAIL, draft);
            if (!validation.isValid) { setError(validation.error || 'Save email configuration or skip email setup'); return; }
        }
        setIsSubmitting(true);
        setError(null);

        const result = await finalize.run(async () => { await refreshAccounts(); }, 'Could not refresh accounts. Your saved setup is retained; retry completion.');
        if (result.ok && activeAccountId.current === draft.store.accountId) {
            clearDraftFromStorage({ userId, mode: isAddingNew ? 'add' : 'setup' });
            navigate('/dashboard');
        }
        if (finalize.isActive()) { setIsSubmitting(false); if (!result.ok) setError('Could not complete setup. Your saved configuration is retained.'); }
    }, [draft, refreshAccounts, navigate, currentAccount, userId, isAddingNew, finalize]);

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
    if (!draftLoaded) return <p role="status">Loading saved setup...</p>;
    if (draft.store.connectionVerified && draft.store.accountId !== currentAccount?.id) return <p role="alert">This setup belongs to another account. Switch back to that account before continuing.</p>;

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
                                onStepClick={goToStep}
                                disabled={isSubmitting}
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
                            {STEP_CONFIG.map((step) => {
                                const isClickable = draft.completedSteps.includes(step.id)
                                    || draft.skippedSteps.includes(step.id)
                                    || step.id === currentStep;
                                return (
                                    <button
                                        key={step.id}
                                        type="button"
                                        onClick={() => isClickable && goToStep(step.id)}
                                        className={`w-2.5 h-2.5 rounded-full transition-colors ${isClickable ? 'cursor-pointer' : 'cursor-default'} ${step.id === currentStep
                                            ? 'bg-blue-600'
                                            : draft.completedSteps.includes(step.id)
                                                ? 'bg-green-500'
                                                : draft.skippedSteps.includes(step.id)
                                                    ? 'bg-amber-400'
                                                    : 'bg-gray-300'
                                            }`}
                                        aria-label={`Go to ${step.label}`}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
