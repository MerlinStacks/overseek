import type { CSSProperties } from 'react';
import { createBrandTokens, DEFAULT_BRAND_COLOR, isBrandColor } from '../../utils/brandColors';

interface MobileAppearance {
    appName?: string;
    logoUrl?: string;
    primaryColor?: string;
}

/** Keep brand colours local to the companion; never interpolate arbitrary CSS. */
export function getMobileBranding(appearance?: MobileAppearance, accountName?: string) {
    const raw = appearance?.primaryColor?.trim();
    const tokens = createBrandTokens(isBrandColor(raw) ? raw : DEFAULT_BRAND_COLOR);
    const color = tokens['--primary-color'];

    return {
        name: appearance?.appName?.trim() || accountName?.trim() || 'OverSeek',
        logoUrl: appearance?.logoUrl?.trim() || '',
        style: {
            ...tokens,
            '--mobile-brand': color,
            '--mobile-brand-foreground': tokens['--primary-foreground'],
            // Mixing with white gives even very dark brand colours readable text on dark surfaces.
            '--mobile-accent': `color-mix(in srgb, ${color} 45%, white)`,
        } as CSSProperties,
    };
}
