/**
 * Onboarding Wizard Types
 * 
 * Centralized type definitions for the Account Setup Wizard.
 * Follows the pattern established by CampaignWizard.
 */

import { LucideIcon, Store, Plug, Mail, TrendingUp, CheckCircle } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Wizard step identifiers */
export const ONBOARDING_STEPS = {
    STORE: 1,
    PLUGIN: 2,
    EMAIL: 3,
    ADS: 4,
    REVIEW: 5,
    TOTAL: 5
} as const;

/** Step metadata for rendering */
export interface StepConfig {
    id: number;
    label: string;
    description: string;
    icon: LucideIcon;
    skippable: boolean;
}

/** Configuration for all wizard steps */
export const STEP_CONFIG: StepConfig[] = [
    {
        id: ONBOARDING_STEPS.STORE,
        label: 'Store Setup',
        description: 'Connect your WooCommerce store',
        icon: Store,
        skippable: false
    },
    {
        id: ONBOARDING_STEPS.PLUGIN,
        label: 'Plugin Setup',
        description: 'Install and configure the OverSeek plugin',
        icon: Plug,
        skippable: true
    },
    {
        id: ONBOARDING_STEPS.EMAIL,
        label: 'Email Setup',
        description: 'Configure outbound email notifications',
        icon: Mail,
        skippable: true
    },
    {
        id: ONBOARDING_STEPS.ADS,
        label: 'Ad Accounts',
        description: 'Connect Google Ads and Meta Ads',
        icon: TrendingUp,
        skippable: true
    },
    {
        id: ONBOARDING_STEPS.REVIEW,
        label: 'Review & Launch',
        description: 'Review your setup and get started',
        icon: CheckCircle,
        skippable: false
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Store connection details */
export interface StoreData {
    name: string;
    domain: string;
    wooUrl: string;
    wooConsumerKey: string;
    wooConsumerSecret: string;
    connectionVerified: boolean;
}

/** Plugin installation status */
export interface PluginData {
    downloaded: boolean;
    configCopied: boolean;
    verified: boolean;
    pluginVersion?: string;
}

/** Email account configuration */
export interface EmailData {
    enabled: boolean;
    name: string;
    email: string;
    smtpHost: string;
    smtpPort: number;
    smtpUsername: string;
    smtpPassword: string;
    smtpSecure: boolean;
    verified: boolean;
}

/** Ad account connections */
export interface AdsData {
    googleEnabled: boolean;
    googleConnected: boolean;
    googleAccountId?: string;
    googleAccountName?: string;
    metaEnabled: boolean;
    metaConnected: boolean;
    metaAccessToken?: string;
    metaAdAccountId?: string;
}

/** Complete onboarding draft state */
export interface OnboardingDraft {
    store: StoreData;
    plugin: PluginData;
    email: EmailData;
    ads: AdsData;
    skippedSteps: number[];
    completedSteps: number[];
}

/** Props passed to all step components */
export interface OnboardingStepProps {
    draft: OnboardingDraft;
    setDraft: React.Dispatch<React.SetStateAction<OnboardingDraft>>;
    onNext: () => void;
    onBack: () => void;
    onSkip: () => void;
    isSubmitting: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates if the current step can proceed to the next.
 * @returns Object with isValid flag and optional error message
 */
export function validateStep(step: number, draft: OnboardingDraft): { isValid: boolean; error?: string } {
    switch (step) {
        case ONBOARDING_STEPS.STORE:
            if (!draft.store.name.trim()) {
                return { isValid: false, error: 'Store name is required' };
            }
            if (!draft.store.wooUrl.trim()) {
                return { isValid: false, error: 'WooCommerce URL is required' };
            }
            if (!draft.store.wooConsumerKey.trim()) {
                return { isValid: false, error: 'Consumer Key is required' };
            }
            if (!draft.store.wooConsumerSecret.trim()) {
                return { isValid: false, error: 'Consumer Secret is required' };
            }
            return { isValid: true };

        case ONBOARDING_STEPS.PLUGIN:
            // Plugin setup is optional but if attempted, should be verified
            return { isValid: true };

        case ONBOARDING_STEPS.EMAIL:
            // If email is enabled, validate required fields
            if (draft.email.enabled) {
                if (!draft.email.smtpHost.trim()) {
                    return { isValid: false, error: 'SMTP host is required' };
                }
                if (!draft.email.smtpUsername.trim()) {
                    return { isValid: false, error: 'SMTP username is required' };
                }
            }
            return { isValid: true };

        case ONBOARDING_STEPS.ADS:
            // Ads are optional
            return { isValid: true };

        case ONBOARDING_STEPS.REVIEW:
            // Review step just needs store to be configured
            if (!draft.store.name.trim()) {
                return { isValid: false, error: 'Please complete store setup first' };
            }
            return { isValid: true };

        default:
            return { isValid: true };
    }
}

/** Creates empty initial draft state */
export function createInitialDraft(): OnboardingDraft {
    return {
        store: {
            name: '',
            domain: '',
            wooUrl: '',
            wooConsumerKey: '',
            wooConsumerSecret: '',
            connectionVerified: false,
        },
        plugin: {
            downloaded: false,
            configCopied: false,
            verified: false,
        },
        email: {
            enabled: false,
            name: '',
            email: '',
            smtpHost: '',
            smtpPort: 587,
            smtpUsername: '',
            smtpPassword: '',
            smtpSecure: true,
            verified: false,
        },
        ads: {
            googleEnabled: false,
            googleConnected: false,
            metaEnabled: false,
            metaConnected: false,
        },
        skippedSteps: [],
        completedSteps: [],
    };
}

/** LocalStorage key for persisting draft */
export const ONBOARDING_STORAGE_KEY = 'overseek_onboarding_draft';

/** Save draft to localStorage (excludes sensitive data like SMTP password) */
export function saveDraftToStorage(draft: OnboardingDraft, currentStep: number): void {
    try {
        // Exclude sensitive fields before persisting
        const safeDraft: OnboardingDraft = {
            ...draft,
            email: {
                ...draft.email,
                smtpPassword: '' // Never store passwords in localStorage
            }
        };
        localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ draft: safeDraft, currentStep }));
    } catch {
        // Silently fail if localStorage is unavailable
    }
}

/** Load draft from localStorage */
export function loadDraftFromStorage(): { draft: OnboardingDraft; currentStep: number } | null {
    try {
        const stored = localStorage.getItem(ONBOARDING_STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch {
        // Return null if parsing fails
    }
    return null;
}

/** Clear draft from localStorage */
export function clearDraftFromStorage(): void {
    try {
        localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    } catch {
        // Silently fail
    }
}
