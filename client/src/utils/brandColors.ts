/** Explicit account-brand tokens. Semantic status and Tailwind colour scales stay independent. */
export const DEFAULT_BRAND_COLOR = '#2563eb';

export function isBrandColor(value: unknown): value is string {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function relativeLuminance(color: string): number {
    const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function mix(color: string, target: number, amount: number): string {
    return `#${[1, 3, 5].map(offset => Math.round(parseInt(color.slice(offset, offset + 2), 16) * (1 - amount) + target * amount).toString(16).padStart(2, '0')).join('')}`;
}

/** Black/white selection guarantees WCAG AA normal-text contrast for any valid brand. */
export function createBrandTokens(value: unknown): Record<string, string> {
    const color = isBrandColor(value) ? value.toLowerCase() : DEFAULT_BRAND_COLOR;
    const luminance = relativeLuminance(color);
    const foreground = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
    return {
        '--primary-color': color,
        '--primary-foreground': foreground,
        '--primary-hover': mix(color, foreground === '#ffffff' ? 0 : 255, 0.1),
        '--brand-50': mix(color, 255, 0.96),
        '--brand-100': mix(color, 255, 0.9),
        '--brand-200': mix(color, 255, 0.75),
        '--brand-300': mix(color, 255, 0.55),
        '--brand-400': mix(color, 255, 0.25),
        '--brand-500': color,
        '--brand-600': mix(color, 0, 0.2),
        '--brand-700': mix(color, 0, 0.45),
        '--brand-800': mix(color, 0, 0.65),
        '--brand-900': mix(color, 0, 0.8),
    };
}
