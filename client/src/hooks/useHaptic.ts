import { useCallback, useEffect, useRef } from 'react';
type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'selection';
const patterns: Record<HapticPattern, number | number[]> = { light: 10, medium: 20, heavy: 30, success: [20, 50, 20], error: [15, 30, 15], selection: 5 };
type Bridge = typeof import('@capacitor/haptics');
function native() {
    try {
        const bridge = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; isPluginAvailable?: (name: string) => boolean } }).Capacitor;
        return bridge?.isNativePlatform?.() === true && (bridge.isPluginAvailable?.('Haptics') ?? true);
    } catch { return false; }
}
/** Optional feedback only; callers can disable it, and reduced-motion requests are respected. */
export function useHaptic({ enabled = true }: { enabled?: boolean } = {}) {
    const mounted = useRef(false); const version = useRef(0); const pending = useRef<Promise<Bridge | null> | null>(null);
    useEffect(() => { const counter = version; mounted.current = true; return () => { mounted.current = false; counter.current++; }; }, [enabled]);
    const triggerHaptic = useCallback(async (value: HapticPattern | number = 'light') => {
        const generation = ++version.current;
        const allowed = () => mounted.current && enabled && generation === version.current && typeof navigator !== 'undefined' &&
            (typeof document === 'undefined' || document.visibilityState !== 'hidden') && !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
        if (!allowed()) return;
        if (typeof value === 'number' && (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > 200)) return;
        if (typeof value !== 'number' && !Object.prototype.hasOwnProperty.call(patterns, value)) return;
        const pattern: HapticPattern = typeof value === 'number' ? value <= 7 ? 'selection' : value <= 15 ? 'light' : value <= 25 ? 'medium' : 'heavy' : value;
        if (native()) {
            pending.current ??= import('@capacitor/haptics').catch(() => null);
            const bridge = await pending.current;
            if (!allowed()) return;
            if (bridge) {
                try {
                    if (pattern === 'selection') {
                        await bridge.Haptics.selectionStart();
                        try { if (allowed()) await bridge.Haptics.selectionChanged(); }
                        finally { await bridge.Haptics.selectionEnd(); }
                    } else if (pattern === 'success' || pattern === 'error') {
                        await bridge.Haptics.notification({ type: pattern === 'success' ? bridge.NotificationType.Success : bridge.NotificationType.Error });
                    } else await bridge.Haptics.impact({ style: pattern === 'light' ? bridge.ImpactStyle.Light : pattern === 'medium' ? bridge.ImpactStyle.Medium : bridge.ImpactStyle.Heavy });
                    return;
                } catch { /* Native failure can fall back to a bounded browser vibration. */ }
            }
        }
        if (allowed() && typeof navigator.vibrate === 'function') {
            try { navigator.vibrate(typeof value === 'number' ? value : patterns[pattern]); } catch { /* Feedback is optional. */ }
        }
    }, [enabled]);
    return { triggerHaptic, isHapticSupported: native() || typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' };
}
