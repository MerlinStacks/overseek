export type FeedVariationMode =
    | 'automatic'
    | 'variable_parent'
    | 'all_variations'
    | 'default_variation'
    | 'first_variation'
    | 'last_variation'
    | 'variable_and_variations';

export const FEEDS_UI_STATE_KEY = 'overseek:feeds:ui-state:v1';

const FEED_VARIATION_MODES = new Set<FeedVariationMode>([
    'automatic',
    'variable_parent',
    'all_variations',
    'default_variation',
    'first_variation',
    'last_variation',
    'variable_and_variations',
]);

export function getStoredFeedVariationMode(rawState: string | null): FeedVariationMode {
    if (!rawState) return 'automatic';

    try {
        const variationMode = JSON.parse(rawState)?.variationMode;
        return FEED_VARIATION_MODES.has(variationMode) ? variationMode : 'automatic';
    } catch {
        return 'automatic';
    }
}
