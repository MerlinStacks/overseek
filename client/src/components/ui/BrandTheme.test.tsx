import { StrictMode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrandTokens, DEFAULT_BRAND_COLOR, relativeLuminance } from '../../utils/brandColors';
import { ThemeInjector } from '../layout/ThemeInjector';

const state = vi.hoisted(() => ({ color: '#2563eb' as unknown, account: 'a', token: 'token', user: 'user' }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: state.account, appearance: { primaryColor: state.color } } }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: state.token, user: { id: state.user } }) }));
beforeEach(() => { state.color = '#2563eb'; state.account = 'a'; state.token = 'token'; state.user = 'user'; });
afterEach(() => { cleanup(); document.documentElement.removeAttribute('style'); });

describe('explicit brand palette', () => {
    it('keeps action, hover and highlight contrast across a representative RGB grid', () => {
        let minimumContrast = 21;
        for (let red = 0; red < 256; red += 17) {
            for (let green = 0; green < 256; green += 17) {
                for (let blue = 0; blue < 256; blue += 17) {
                    const color = `#${[red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
                    const tokens = createBrandTokens(color);
                    for (const [text, background] of [['--primary-foreground', '--primary-color'], ['--primary-foreground', '--primary-hover'], ['--brand-800', '--brand-50'], ['--brand-200', '--brand-900']]) {
                        const values = [relativeLuminance(tokens[text]), relativeLuminance(tokens[background])].sort((a, b) => b - a);
                        minimumContrast = Math.min(minimumContrast, (values[0] + 0.05) / (values[1] + 0.05));
                    }
                }
            }
        }
        expect(minimumContrast).toBeGreaterThanOrEqual(4.5);
    });
    it.each(['#000000', '#ffffff', '#ffff00', '#00ff00', '#ff0000', '#777777', '#2563eb', '#123abc'])('provides AA contrast for %s including hover', color => {
        const tokens = createBrandTokens(color);
        for (const key of ['--primary-color', '--primary-hover']) {
            const values = [relativeLuminance(tokens[key]), relativeLuminance(tokens['--primary-foreground'])].sort((a, b) => b - a);
            expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(4.5);
        }
        expect(tokens['--brand-500']).toBe(color);
        for (const [text, background] of [['--brand-800', '--brand-50'], ['--brand-200', '--brand-900']]) {
            const values = [relativeLuminance(tokens[text]), relativeLuminance(tokens[background])].sort((a, b) => b - a);
            expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(4.5);
        }
        expect(tokens).not.toHaveProperty('--color-blue-500');
        expect(tokens).not.toHaveProperty('--color-success-500');
        expect(Object.keys(tokens)).toHaveLength(13);
    });
    it.each([null, undefined, '', '#fff', 'red', '#000000; color:red', '#gggggg'])('rejects invalid CSS colour input %s', value => {
        expect(createBrandTokens(value)['--primary-color']).toBe(DEFAULT_BRAND_COLOR);
    });
});

describe('theme token ownership', () => {
    it('installs explicit tokens in StrictMode and restores existing values and priorities', () => {
        const style = document.documentElement.style;
        style.setProperty('--primary-color', '#abcdef', 'important');
        style.setProperty('--color-blue-500', 'blue');
        style.setProperty('--color-success-500', 'green');
        const view = render(<StrictMode><ThemeInjector /></StrictMode>);
        expect(style.getPropertyValue('--primary-color')).toBe('#2563eb');
        expect(style.getPropertyValue('--brand-50')).toBe(createBrandTokens(state.color)['--brand-50']);
        expect(style.getPropertyValue('--color-blue-500')).toBe('blue');
        expect(style.getPropertyValue('--color-success-500')).toBe('green');
        view.unmount();
        expect(style.getPropertyValue('--primary-color')).toBe('#abcdef');
        expect(style.getPropertyPriority('--primary-color')).toBe('important');
        expect(style.getPropertyValue('--brand-50')).toBe('');
    });
    it('updates the account palette and removes it on logout', () => {
        const view = render(<ThemeInjector />);
        state.color = '#ffff00'; state.account = 'b';
        view.rerender(<ThemeInjector />);
        expect(document.documentElement.style.getPropertyValue('--primary-foreground')).toBe('#000000');
        state.token = '';
        view.rerender(<ThemeInjector />);
        expect(document.documentElement.style.getPropertyValue('--primary-color')).toBe('');
        expect(document.documentElement.style.getPropertyValue('--brand-500')).toBe('');
    });
    it('restores a remaining owner without clearing its palette', () => {
        const first = render(<ThemeInjector />);
        state.color = '#ffffff';
        const second = render(<ThemeInjector />);
        second.unmount();
        expect(document.documentElement.style.getPropertyValue('--primary-color')).toBe('#2563eb');
        first.unmount();
        expect(document.documentElement.style.getPropertyValue('--brand-100')).toBe('');
    });
    it('does not overwrite tokens subsequently changed by another owner', () => {
        const view = render(<ThemeInjector />);
        document.documentElement.style.setProperty('--brand-100', '#123456');
        view.unmount();
        expect(document.documentElement.style.getPropertyValue('--brand-100')).toBe('#123456');
    });
    it.each(['invalid', null, '#fff'])('does not install invalid account input %s', color => {
        state.color = color;
        render(<ThemeInjector />);
        expect(document.documentElement.style.getPropertyValue('--primary-color')).toBe('');
    });
});
