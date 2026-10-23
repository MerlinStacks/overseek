import { describe, expect, it } from 'vitest';
import { getMobileBranding } from './mobileBranding';
import { createBrandTokens, relativeLuminance } from '../../utils/brandColors';

describe('companion branding', () => {
    it('uses the saved Appearance identity', () => {
        const brand = getMobileBranding({ appName: '  CustomKings ', primaryColor: '#daae32', logoUrl: 'https://example.com/logo.png' }, 'Account');
        expect(brand.name).toBe('CustomKings');
        expect(brand.logoUrl).toBe('https://example.com/logo.png');
        expect(brand.style).toMatchObject({ '--mobile-brand': '#daae32', '--mobile-brand-foreground': '#000000' });
    });

    it('falls back safely for missing or invalid colours', () => {
        expect(getMobileBranding(undefined, 'Store').name).toBe('Store');
        expect(getMobileBranding().name).toBe('OverSeek');
        for (const primaryColor of ['', 'red; background: url(bad)', '#12345', 'transparent']) {
            expect(getMobileBranding({ primaryColor }).style).toHaveProperty('--mobile-brand', '#2563eb');
        }
    });

    it('uses legible foregrounds for light and dark brands', () => {
        expect(getMobileBranding({ primaryColor: '#ffffff' }).style).toHaveProperty('--mobile-brand-foreground', '#000000');
        expect(getMobileBranding({ primaryColor: '#000000' }).style).toHaveProperty('--mobile-brand-foreground', '#ffffff');
    });

    it.each(['#daae32', '#777777', '#767676', '#123456', '#eeeeee'])('matches desktop tokens and keeps AA contrast for %s', primaryColor => {
        const style = getMobileBranding({ primaryColor }).style as Record<string, string>;
        expect(style['--mobile-brand-foreground']).toBe(createBrandTokens(primaryColor)['--primary-foreground']);
        const background = relativeLuminance(style['--mobile-brand']);
        const foreground = relativeLuminance(style['--mobile-brand-foreground']);
        expect((Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)).toBeGreaterThanOrEqual(4.5);
    });

    it('does not retain branding when switching to an unbranded account', () => {
        getMobileBranding({ appName: 'First', primaryColor: '#ff0000', logoUrl: '/first.png' });
        const next = getMobileBranding(undefined, 'Second');
        expect(next.name).toBe('Second');
        expect(next.logoUrl).toBe('');
        expect(next.style).toHaveProperty('--mobile-brand', '#2563eb');
    });
});
