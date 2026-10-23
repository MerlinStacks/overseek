import { useLayoutEffect } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { createBrandTokens, isBrandColor } from '../../utils/brandColors';

const owners = new Map<symbol, Record<string, string>>();
let baseline: Array<[string, string, string]> | null = null;
let installed: Record<string, string> = {};
function claimTokens(values: Record<string, string>) {
    const style = document.documentElement.style, owner = Symbol('account-theme');
    if (!owners.size) baseline = Object.keys(values).map(key => [key, style.getPropertyValue(key), style.getPropertyPriority(key)]);
    owners.set(owner, values);
    for (const [key, value] of Object.entries(values)) style.setProperty(key, value);
    installed = values;
    return () => {
        owners.delete(owner);
        const remaining = [...owners.values()];
        const next = remaining[remaining.length - 1];
        for (const [key, value, priority] of baseline ?? []) {
            if (style.getPropertyValue(key) !== installed[key]) continue;
            if (next) style.setProperty(key, next[key]);
            else if (value) style.setProperty(key, value, priority);
            else style.removeProperty(key);
        }
        if (next) installed = next;
        else { installed = {}; baseline = null; }
    };
}

/** Brand tokens only. Never globally recolor semantic utility classes. */
export function ThemeInjector() {
    const { currentAccount } = useAccount(), { token, user } = useAuth();
    const raw = currentAccount?.appearance?.primaryColor;
    const color = isBrandColor(raw) ? raw : null;
    useLayoutEffect(() => {
        if (!token || !user?.id || !currentAccount?.id || !color) return;
        return claimTokens(createBrandTokens(color));
    }, [token, user?.id, currentAccount?.id, color]);
    return null;
}
