import { useAccount } from '../context/AccountContext';

const DEFAULT_ENABLED_LEGACY_FLAGS = new Set(['EMAIL', 'BOT_SHIELD']);

export function useAccountFeature(featureKey: string): boolean {
    const { currentAccount } = useAccount();

    if (!currentAccount || !currentAccount.features) return false;

    const feature = currentAccount.features.find(f => f.featureKey === featureKey);
    if (feature) return feature.isEnabled;

    // Backward compatibility for existing accounts created before these
    // flags were introduced.
    return DEFAULT_ENABLED_LEGACY_FLAGS.has(featureKey);
}
