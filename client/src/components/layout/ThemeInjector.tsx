import { useLayoutEffect } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';

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
    const color = typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw : null;
    useLayoutEffect(() => {
        if (!token || !user?.id || !currentAccount?.id || !color) return;
        const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
        const values = { '--primary-color': color, '--primary-foreground': luminance > .179 ? '#000000' : '#ffffff' };
        return claimTokens(values);
    }, [token, user?.id, currentAccount?.id, color]);
    return null;
}
