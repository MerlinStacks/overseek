import { describe, expect, it } from 'vitest';
import { getChannelDisplayName, isPaidChannel, normalizeChannel } from './ChannelUtils';
describe('channel normalization', () => {
    it.each([
        [null, 'direct'], ['', 'direct'], ['  ', 'direct'], ['(direct)', 'direct'],
        ['google / organic', 'organic_search'], ['google', 'other'], ['google-ads', 'google'], ['Google Ads', 'google'],
        ['google / cpc', 'google'], ['https://google.com/search?q=ads', 'organic_search'], ['google.com.au', 'organic_search'],
        ['https://store.example/?gclid=123', 'google'], ['https://store.example/?gclid=', 'other'],
        ['https://facebook.com', 'social_organic'], ['instagram', 'social_organic'], ['facebook / organic', 'social_organic'],
        ['Facebook Ads', 'meta'], ['fb / paid_social', 'meta'], ['https://facebook.com/?fbclid=123', 'social_organic'],
        ['cpc', 'paid_other'], ['paid', 'paid_other'], ['tiktok / paid_social', 'paid_other'],
        ['mail.google.com', 'email'], ['newsletter', 'email'], ['social_organic', 'social_organic'],
        ['notgoogle.example', 'other'], ['somefbthing', 'other'], ['https://store.test/blog/google-ads', 'other'],
        ['google.evil.com', 'other'], ['organicshop.example', 'other'],
    ])('normalizes %j without inferring paid attribution from a provider name', (source, expected) => {
        expect(normalizeChannel(source)).toBe(expected);
    });
    it('uses explicit campaign medium when available', () => {
        expect(normalizeChannel('google', 'cpc')).toBe('google');
        expect(normalizeChannel('facebook', 'paid_social')).toBe('meta');
        expect(normalizeChannel('google', 'organic')).toBe('organic_search');
        expect(normalizeChannel('https://store.test/?utm_source=google&utm_medium=cpc')).toBe('google');
    });
    it('keeps unknown-provider paid traffic distinct and labels every channel', () => {
        expect(isPaidChannel('paid_other')).toBe(true);
        expect(isPaidChannel('organic_search')).toBe(false);
        expect(isPaidChannel('social_organic')).toBe(false);
        expect(getChannelDisplayName('paid_other')).toContain('provider unknown');
        expect(getChannelDisplayName('google')).toBe('Google Ads');
    });
});
