/**
 * Onboarding Wizard Types
 * 
 * Centralized type definitions for the Account Setup Wizard.
 * Follows the pattern established by CampaignWizard.
 */

import { LucideIcon, Store, Plug, Mail, TrendingUp, CheckCircle } from 'lucide-react';
import { isRecord } from '../../utils/responseValidation';

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
    accountId?: string;
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
    verifiedAccountId?: string;
    savedEmailId?: string;
    configured?: boolean;
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
            try {
                const url = new URL(draft.store.wooUrl);
                if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid URL');
            } catch { return { isValid: false, error: 'Enter a valid HTTP or HTTPS store URL without embedded credentials' }; }
            if (draft.store.connectionVerified && draft.store.accountId) return { isValid: true };
            if (!draft.store.wooConsumerKey.trim()) {
                return { isValid: false, error: 'Consumer Key is required' };
            }
            if (!draft.store.wooConsumerSecret.trim()) {
                return { isValid: false, error: 'Consumer Secret is required' };
            }
            return { isValid: false, error: 'Verify the store connection before continuing' };

        case ONBOARDING_STEPS.PLUGIN:
            // Plugin setup is optional but if attempted, should be verified
            return { isValid: true };

        case ONBOARDING_STEPS.EMAIL:
            // If email is enabled, validate required fields
            if (draft.email.enabled) {
                if (!draft.email.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.email)) return { isValid: false, error: 'Email account name and valid email address are required' };
                if (!Number.isInteger(draft.email.smtpPort) || draft.email.smtpPort < 1 || draft.email.smtpPort > 65535) return { isValid: false, error: 'SMTP port must be from 1 to 65535' };
                if (!draft.email.smtpHost.trim()) {
                    return { isValid: false, error: 'SMTP host is required' };
                }
                if (!draft.email.smtpUsername.trim()) {
                    return { isValid: false, error: 'SMTP username is required' };
                }
                if (!draft.email.smtpPassword.trim() && !draft.email.savedEmailId) {
                    return { isValid: false, error: 'SMTP password is required' };
                }
                if (!draft.email.configured || !draft.email.savedEmailId || draft.email.verifiedAccountId !== draft.store.accountId) return { isValid: false, error: 'Save the email configuration for this store, or skip email setup' };
            }
            return { isValid: true };

        case ONBOARDING_STEPS.ADS:
            // Ads are optional
            return { isValid: true };

        case ONBOARDING_STEPS.REVIEW:
            return validateStep(ONBOARDING_STEPS.STORE, draft);

        default:
            return { isValid: false, error: 'Unknown setup step' };
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
            smtpSecure: false, // Port 587 uses STARTTLS rather than implicit TLS.
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

export interface OnboardingStorageScope { userId: string; mode: 'setup' | 'add'; accountId?: string }
function storageKey(scope: OnboardingStorageScope): string {
    if (!scope.userId || !['setup', 'add'].includes(scope.mode)) throw new Error('Draft owner required');
    return `${ONBOARDING_STORAGE_KEY}:${encodeURIComponent(scope.userId)}:${scope.mode}`;
}
const validStep = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= ONBOARDING_STEPS.TOTAL;

/** Rebuild from a whitelist: unknown fields and all credentials are discarded. */
function safeDraft(value: unknown): OnboardingDraft {
    if (!isRecord(value)) throw new Error('Invalid draft');
    const result = createInitialDraft();
    for (const section of ['store', 'plugin', 'email', 'ads'] as const) {
        const source = value[section];
        if (!isRecord(source)) throw new Error('Invalid draft section');
        const target = result[section] as unknown as Record<string, unknown>;
        for (const [key, fallback] of Object.entries(target)) {
            if (typeof source[key] !== typeof fallback) throw new Error('Invalid draft field');
            target[key] = source[key];
        }
    }
    if (!Number.isInteger(result.email.smtpPort) || result.email.smtpPort < 1 || result.email.smtpPort > 65535) throw new Error('Invalid port');
    for (const key of ['completedSteps', 'skippedSteps'] as const) {
        if (!Array.isArray(value[key]) || !value[key].every(validStep)) throw new Error('Invalid steps');
        result[key] = [...new Set(value[key])];
    }
    if (result.skippedSteps.some(step => !STEP_CONFIG.find(item => item.id === step)?.skippable)) throw new Error('Required step skipped');
    const optional = { store: ['accountId'], plugin: ['pluginVersion'], ads: ['googleAccountId', 'googleAccountName', 'metaAdAccountId'] } as const;
    for (const section of ['store', 'plugin', 'ads'] as const) for (const key of optional[section]) {
        const source = value[section] as Record<string, unknown>;
        if (source[key] !== undefined && typeof source[key] !== 'string') throw new Error('Invalid draft field');
        if (typeof source[key] === 'string') (result[section] as unknown as Record<string, unknown>)[key] = source[key];
    }
    result.store.wooConsumerKey = ''; result.store.wooConsumerSecret = ''; result.email.smtpPassword = '';
    // A local connection test is never evidence of a saved sending account.
    result.email.verified = false;
    const email = value.email as Record<string, unknown>;
    if (typeof email.savedEmailId === 'string' && typeof email.verifiedAccountId === 'string' && email.configured === true) {
        result.email.savedEmailId = email.savedEmailId; result.email.verifiedAccountId = email.verifiedAccountId; result.email.configured = true;
    }
    // Ads' optional Meta access token is deliberately never copied, even on restore.
    return result;
}

/** Drafts belong to a user and wizard intent; verified state is bound to an account. */
export function saveDraftToStorage(draft: OnboardingDraft, currentStep: number, scope: OnboardingStorageScope): void {
    try {
        localStorage.removeItem(ONBOARDING_STORAGE_KEY); // Discard the old unowned, potentially secret-bearing draft.
        if (!validStep(currentStep)) return;
        localStorage.setItem(storageKey(scope), JSON.stringify({ version: 1, draft: safeDraft(draft), currentStep, verifiedAccountId: draft.store.connectionVerified && draft.store.accountId === scope.accountId ? scope.accountId : undefined }));
    } catch {
        // Silently fail if localStorage is unavailable
    }
}

/** Load draft from localStorage */
export function loadDraftFromStorage(scope: OnboardingStorageScope): { draft: OnboardingDraft; currentStep: number; wizardSessionActive: boolean } | null {
    try {
        localStorage.removeItem(ONBOARDING_STORAGE_KEY);
        const stored = localStorage.getItem(storageKey(scope));
        if (stored) {
            const data: unknown = JSON.parse(stored);
            if (!isRecord(data) || data.version !== 1 || !validStep(data.currentStep)) return null;
            const draft = safeDraft(data.draft);
            const verified = !!scope.accountId && data.verifiedAccountId === scope.accountId && draft.store.accountId === scope.accountId && draft.store.connectionVerified;
            if (!verified) {
                draft.store.connectionVerified = false; delete draft.store.accountId; draft.plugin.verified = false; draft.email.verified = false;
                draft.ads.googleConnected = false; draft.ads.metaConnected = false;
                draft.completedSteps = []; draft.skippedSteps = [];
            }
            return { draft, currentStep: verified ? data.currentStep : ONBOARDING_STEPS.STORE, wizardSessionActive: verified };
        }
    } catch {
        // Return null if parsing fails
    }
    return null;
}

/** Clear draft from localStorage */
export function clearDraftFromStorage(scope: OnboardingStorageScope): void {
    try {
        localStorage.removeItem(ONBOARDING_STORAGE_KEY);
        localStorage.removeItem(storageKey(scope));
    } catch {
        // Silently fail
    }
}
