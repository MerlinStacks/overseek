import { useCallback, useRef } from 'react';

/**
 * Haptic feedback patterns for consistent tactile responses.
 */
export type HapticPattern =
    | 'light'    // 10ms - subtle tap
    | 'medium'   // 20ms - standard interaction  
    | 'heavy'    // 30ms - significant action
    | 'success'  // pulse pattern - positive confirmation
    | 'error'    // double-tap - error/warning
    | 'selection'; // 5ms - UI selection change

/** Duration mapping for each pattern (Vibration API fallback). */
const PATTERN_DURATIONS: Record<HapticPattern, number | number[]> = {
    light: 10,
    medium: 20,
    heavy: 30,
    success: [20, 50, 20],
    error: [15, 30, 15],
    selection: 5
};

/**
 * Hook for haptic feedback across PWA and Capacitor native apps.
 *
 * Uses Capacitor Haptics when available (native builds), falls back to
 * Vibration API for PWA mode. Capacitor is loaded dynamically to avoid
 * build failures when the package is not installed (e.g. Docker web builds).
 *
 * Supports both named patterns and numeric durations for backward compatibility.
 *
 * @example
 * ```tsx
 * const { triggerHaptic } = useHaptic();
 *
 * // Using named patterns (recommended)
 * triggerHaptic('light');
 * triggerHaptic('success');
 *
 * // Using numeric duration (legacy support)
 * triggerHaptic(20);
 * triggerHaptic(); // defaults to 'light' / 10ms
 * ```
 */
export function useHaptic() {
    // Cache the dynamic import result so we only resolve once
    const capacitorRef = useRef<{ Haptics: any; ImpactStyle: any } | null | false>(null);

    /**
     * Lazily loads @capacitor/haptics. Returns the module or null if unavailable.
     */
    const getCapacitor = async () => {
        if (capacitorRef.current === false) return null; // previously failed
        if (capacitorRef.current) return capacitorRef.current;

        try {
            const mod = await import('@capacitor/haptics');
            capacitorRef.current = { Haptics: mod.Haptics, ImpactStyle: mod.ImpactStyle };
            return capacitorRef.current;
        } catch {
            capacitorRef.current = false; // mark as unavailable
            return null;
        }
    };

    /**
     * Converts numeric duration to nearest named pattern.
     */
    const durationToPattern = (duration: number): HapticPattern => {
        if (duration <= 7) return 'selection';
        if (duration <= 15) return 'light';
        if (duration <= 25) return 'medium';
        return 'heavy';
    };

    /**
     * Triggers haptic feedback with the specified pattern or duration.
     * Gracefully fails on unsupported devices.
     * 
     * @param patternOrDuration - Pattern name or duration in milliseconds
     */
    const triggerHaptic = useCallback(async (patternOrDuration?: HapticPattern | number) => {
        // Normalize input to pattern and duration
        let pattern: HapticPattern;
        let durationMs: number | number[];

        if (typeof patternOrDuration === 'number') {
            pattern = durationToPattern(patternOrDuration);
            durationMs = patternOrDuration;
        } else {
            pattern = patternOrDuration || 'light';
            durationMs = PATTERN_DURATIONS[pattern];
        }

        // Try Capacitor Haptics first (native builds)
        const cap = await getCapacitor();
        if (cap) {
            try {
                const { Haptics, ImpactStyle } = cap;
                switch (pattern) {
                    case 'light':
                        await Haptics.impact({ style: ImpactStyle.Light });
                        break;
                    case 'medium':
                        await Haptics.impact({ style: ImpactStyle.Medium });
                        break;
                    case 'heavy':
                        await Haptics.impact({ style: ImpactStyle.Heavy });
                        break;
                    case 'success':
                        await Haptics.notification({ type: 'success' as never });
                        break;
                    case 'error':
                        await Haptics.notification({ type: 'error' as never });
                        break;
                    case 'selection':
                        await Haptics.selectionStart();
                        break;
                }
                return;
            } catch {
                // Fall through to Vibration API
            }
        }

        // Fallback to Vibration API (PWA mode)
        if ('vibrate' in navigator) {
            try {
                navigator.vibrate(durationMs);
            } catch {
                // Vibration not available - fail silently
            }
        }
    }, []);

    /**
     * Checks if any haptic feedback is supported.
     */
    const isHapticSupported = 'vibrate' in navigator;

    return {
        triggerHaptic,
        isHapticSupported
    };
}
