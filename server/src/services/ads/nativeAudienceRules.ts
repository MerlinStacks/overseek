export const META_WEBSITE_EVENTS = ['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase'] as const;
export const LOOKALIKE_COUNTRIES = ['AU', 'NZ', 'US', 'GB', 'CA', 'IE', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'SG', 'JP'];

export interface WebsiteAudienceDefinition {
    pixelId?: string;
    event?: string;
    urlContains?: string;
    excludePurchasers: boolean;
    purchaseUrlContains?: string;
    retentionDays: number;
    exclusionDays: number;
    tagConfirmed?: boolean;
}

export interface LookalikeDefinition {
    sourceType: 'CUSTOMER_LIST' | 'WEBSITE';
    sourceId: string;
    country: string;
    percent: 1 | 3 | 5;
}

const validFragment = (value: unknown) => typeof value === 'string' && value.trim().length >= 2 && value.length <= 500 && !/[\r\n\x00]/.test(value); // eslint-disable-line no-control-regex -- Reject newlines and nulls from audience rule fragments.
const validDays = (value: unknown, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;

/** Whitelist and normalize user input before it can become platform rules. */
export function parseWebsiteDefinition(platform: string, input: any): WebsiteAudienceDefinition {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Website rules are required');
    const max = platform === 'META' ? 180 : 540;
    if (!validDays(input.retentionDays, max) || !validDays(input.exclusionDays, max)) throw new Error(`Day windows must be whole numbers from 1 to ${max}`);
    if (typeof input.excludePurchasers !== 'boolean') throw new Error('Choose whether to exclude purchasers');
    const definition: WebsiteAudienceDefinition = {
        retentionDays: input.retentionDays, exclusionDays: input.exclusionDays, excludePurchasers: input.excludePurchasers
    };
    if (platform === 'META') {
        if (typeof input.pixelId !== 'string' || !/^\d+$/.test(input.pixelId)) throw new Error('Select an accessible Meta pixel');
        if (!META_WEBSITE_EVENTS.includes(input.event)) throw new Error('Unsupported Meta website event');
        if (input.event === 'Purchase' && input.excludePurchasers) throw new Error('A purchaser audience cannot also exclude purchasers');
        definition.pixelId = input.pixelId;
        definition.event = input.event;
        if (input.urlContains) {
            if (!validFragment(input.urlContains)) throw new Error('Invalid URL filter');
            definition.urlContains = input.urlContains.trim();
        }
    } else if (platform === 'GOOGLE') {
        if (input.tagConfirmed !== true) throw new Error('Confirm the Google remarketing tag is active for this destination account');
        if (!validFragment(input.urlContains)) throw new Error('Enter an inclusion URL or path containing at least two characters');
        if (input.excludePurchasers && !validFragment(input.purchaseUrlContains)) throw new Error('Enter the order-confirmation URL or path for purchaser exclusions');
        if (input.excludePurchasers && input.urlContains.trim() === input.purchaseUrlContains.trim()) throw new Error('Inclusion and purchaser exclusion URLs must differ');
        definition.urlContains = input.urlContains.trim();
        if (input.excludePurchasers) definition.purchaseUrlContains = input.purchaseUrlContains.trim();
        definition.tagConfirmed = true;
    } else throw new Error('Unsupported advertising platform');
    return definition;
}

export function parseLookalikeDefinition(input: any): LookalikeDefinition {
    if (!input || !['CUSTOMER_LIST', 'WEBSITE'].includes(input.sourceType) || typeof input.sourceId !== 'string' || !input.sourceId || input.sourceId.length > 100) throw new Error('Select an Overseek-managed source audience');
    const country = typeof input.country === 'string' ? input.country.trim().toUpperCase() : '';
    // ISO membership is checked separately; never accept arbitrary platform targeting JSON.
    if (!LOOKALIKE_COUNTRIES.includes(country)) throw new Error('Choose a supported target country');
    if (![1, 3, 5].includes(input.percent)) throw new Error('Choose a 1%, 3% or 5% lookalike');
    return { sourceType: input.sourceType, sourceId: input.sourceId, country, percent: input.percent };
}

export function buildMetaWebsiteRule(definition: WebsiteAudienceDefinition) {
    const operand = (event: string, days: number, url?: string) => ({
        event_sources: [{ type: 'pixel', id: definition.pixelId }], retention_seconds: days * 86400,
        filter: { operator: 'and', filters: [
            { field: 'event', operator: 'eq', value: event },
            ...(url ? [{ field: 'url', operator: 'i_contains', value: url }] : [])
        ] }
    });
    return {
        inclusions: { operator: 'or', rules: [operand(definition.event!, definition.retentionDays, definition.urlContains)] },
        ...(definition.excludePurchasers ? { exclusions: { operator: 'or', rules: [operand('Purchase', definition.exclusionDays)] } } : {})
    };
}

export function buildGoogleWebsiteList(name: string, definition: WebsiteAudienceDefinition) {
    const operand = (url: string, days: number) => ({
        lookbackWindowDays: days,
        rule: { ruleType: 'OR_OF_ANDS', ruleItemGroups: [{ ruleItems: [{
            name: 'url__', stringRuleItem: { operator: 'CONTAINS', value: url }
        }] }] }
    });
    return {
        name, description: 'Website audience managed by Overseek; membership maintained by Google',
        membershipStatus: 'OPEN', membershipLifeSpan: definition.retentionDays,
        ruleBasedUserList: {
            prepopulationStatus: 'REQUESTED',
            flexibleRuleUserList: {
                inclusiveRuleOperator: 'AND', inclusiveOperands: [operand(definition.urlContains!, definition.retentionDays)],
                exclusiveOperands: definition.excludePurchasers ? [operand(definition.purchaseUrlContains!, definition.exclusionDays)] : []
            }
        }
    };
}
