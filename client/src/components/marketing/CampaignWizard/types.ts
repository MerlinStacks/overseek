/**
 * Campaign Wizard Types
 * 
 * Centralized type definitions for the Campaign Creation Wizard.
 * Extracted for reusability across wizard step components.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Default daily budget for new campaigns */
export const DEFAULT_BUDGET = 20;

/** Maximum headline length per Google Ads spec */
export const MAX_HEADLINE_LENGTH = 30;

/** Maximum description length per Google Ads spec */
export const MAX_DESCRIPTION_LENGTH = 90;

/** Minimum headlines required for Responsive Search Ads */
export const MIN_HEADLINES = 3;

/** Maximum headlines allowed for Responsive Search Ads */
export const MAX_HEADLINES = 15;

/** Minimum descriptions required for Responsive Search Ads */
export const MIN_DESCRIPTIONS = 2;

/** Maximum descriptions allowed for Responsive Search Ads */
export const MAX_DESCRIPTIONS = 4;

/** Wizard step configuration */
export const WIZARD_STEPS = {
    GOAL: 1,
    PRODUCTS: 2,
    AD_COPY: 3,
    BUDGET: 4,
    TOTAL: 4
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Available campaign types */
export type CampaignType = 'SEARCH' | 'PMAX';

/** Keyword match types supported by Google Ads */
export type MatchType = 'BROAD' | 'PHRASE' | 'EXACT';

/** Product item for selection */
export interface WizardProduct {
    id: string;
    name: string;
    price: number | null;
    image?: string;
    sku?: string;
}

/** Keyword configuration */
export interface WizardKeyword {
    text: string;
    matchType: MatchType;
}

/** Ad copy content */
export interface WizardAdCopy {
    headlines: string[];
    descriptions: string[];
    finalUrl: string;
}

/** Complete campaign draft state */
export interface CampaignDraft {
    name: string;
    type: CampaignType;
    selectedProducts: WizardProduct[];
    adCopy: WizardAdCopy;
    budget: number;
    keywords: WizardKeyword[];
}

/** Props passed to all step components */
export interface WizardStepProps {
    draft: CampaignDraft;
    setDraft: React.Dispatch<React.SetStateAction<CampaignDraft>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates if the current step can proceed to the next.
 * @returns Object with isValid flag and optional error message
 */
export function validateStep(step: number, draft: CampaignDraft): { isValid: boolean; error?: string } {
    switch (step) {
        case WIZARD_STEPS.GOAL:
            if (draft.type !== 'SEARCH') {
                return { isValid: false, error: 'Select a supported campaign type' };
            }
            if (!draft.name.trim()) {
                return { isValid: false, error: 'Campaign name is required' };
            }
            return { isValid: true };

        case WIZARD_STEPS.PRODUCTS:
            // Products are optional for Search campaigns
            return { isValid: true };

        case WIZARD_STEPS.AD_COPY:
            if (draft.adCopy.headlines.length > MAX_HEADLINES || draft.adCopy.headlines.some(value => !value.trim() || value.length > MAX_HEADLINE_LENGTH)) {
                return { isValid: false, error: `Use up to ${MAX_HEADLINES} nonblank headlines, each at most ${MAX_HEADLINE_LENGTH} characters` };
            }
            if (draft.adCopy.descriptions.length > MAX_DESCRIPTIONS || draft.adCopy.descriptions.some(value => !value.trim() || value.length > MAX_DESCRIPTION_LENGTH)) {
                return { isValid: false, error: `Use up to ${MAX_DESCRIPTIONS} nonblank descriptions, each at most ${MAX_DESCRIPTION_LENGTH} characters` };
            }
            if (draft.adCopy.headlines.length < MIN_HEADLINES) {
                return { isValid: false, error: `At least ${MIN_HEADLINES} headlines required` };
            }
            if (draft.adCopy.descriptions.length < MIN_DESCRIPTIONS) {
                return { isValid: false, error: `At least ${MIN_DESCRIPTIONS} descriptions required` };
            }
            if (!draft.adCopy.finalUrl) {
                return { isValid: false, error: 'Final URL is required' };
            }
            try {
                const url = new URL(draft.adCopy.finalUrl.trim());
                if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Invalid URL');
            } catch {
                return { isValid: false, error: 'Final URL must be an HTTP or HTTPS website URL without credentials' };
            }
            return { isValid: true };

        case WIZARD_STEPS.BUDGET:
            if (!Number.isFinite(draft.budget) || draft.budget <= 0) {
                return { isValid: false, error: 'Budget must be greater than zero' };
            }
            return { isValid: true };

        default:
            return { isValid: false, error: 'Unknown wizard step' };
    }
}

/** Creates empty initial draft state */
export function createInitialDraft(): CampaignDraft {
    return {
        name: '',
        type: 'SEARCH',
        selectedProducts: [],
        adCopy: { headlines: [], descriptions: [], finalUrl: '' },
        budget: DEFAULT_BUDGET,
        keywords: []
    };
}
