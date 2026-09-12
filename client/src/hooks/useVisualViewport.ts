import { useEffect, useState, type CSSProperties } from 'react';

const fallback: CSSProperties = { height: '100dvh', top: 0 };

/** Fixed-overlay geometry that follows the keyboard without following pinch zoom. */
export function useVisualViewport(enabled = true): CSSProperties {
    const [style, setStyle] = useState<CSSProperties>(fallback);

    useEffect(() => {
        if (!enabled) return;
        const viewport = window.visualViewport;
        const update = () => {
            if (!viewport) {
                setStyle(fallback);
                return;
            }
            // Zoom changes visualViewport geometry too. Keep the last unzoomed
            // size/position until zoom ends, rather than making the overlay jump.
            if (Math.abs(viewport.scale - 1) > 0.01) return;
            if (!Number.isFinite(viewport.height) || viewport.height <= 0
                || !Number.isFinite(viewport.offsetTop)) return;
            const height = viewport.height;
            const top = Math.max(0, viewport.offsetTop);
            setStyle(previous => previous.height === height && previous.top === top
                ? previous : { height, top });
        };

        update();
        viewport?.addEventListener('resize', update);
        viewport?.addEventListener('scroll', update);
        window.addEventListener('resize', update);
        return () => {
            viewport?.removeEventListener('resize', update);
            viewport?.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
        };
    }, [enabled]);

    return enabled ? style : fallback;
}
