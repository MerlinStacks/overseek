import type { CSSProperties } from 'react';

interface MobileAppearance {
    appName?: string;
    logoUrl?: string;
    primaryColor?: string;
}

/** Keep brand colours local to the companion; never interpolate arbitrary CSS. */
export function getMobileBranding(appearance?: MobileAppearance, accountName?: string) {
    const color = /^#[0-9a-f]{6}$/i.test(appearance?.primaryColor?.trim() || '')
        ? appearance!.primaryColor!.trim()
        : '#4f46e5';
    const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255);
    const luminance = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const darkLuminance = 0.0056; // Relative luminance of #0b1120.
    const foreground = (luminance + 0.05) / (darkLuminance + 0.05) > 1.05 / (luminance + 0.05)
        ? '#0b1120' : '#ffffff';

    return {
        name: appearance?.appName?.trim() || accountName?.trim() || 'OverSeek',
        logoUrl: appearance?.logoUrl?.trim() || '',
        style: {
            '--mobile-brand': color,
            '--mobile-brand-foreground': foreground,
            // Mixing with white gives even very dark brand colours readable text on dark surfaces.
            '--mobile-accent': `color-mix(in srgb, ${color} 45%, white)`,
        } as CSSProperties,
    };
}
