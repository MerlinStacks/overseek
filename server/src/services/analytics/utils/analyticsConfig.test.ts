import { describe, expect, it } from 'vitest';
import { inferCategory, normalizeSource } from './analyticsConfig';
describe('analytics source normalization', () => {
    it.each([
        [null, 'Direct'], ['', 'Direct'], ['  ', 'Direct'], ['google', 'Google'], ['https://www.google.com/search?q=mug', 'Google'],
        ['google / organic', 'Organic Search'], ['google / cpc', 'Google Ads'], ['Google Ads', 'Google Ads'],
        ['google_ads', 'Google Ads'], ['https://store.test/?gclid=abc', 'Google Ads'],
        ['facebook', 'Facebook'], ['https://facebook.com/?fbclid=abc', 'Facebook'], ['Meta Ads', 'Meta Ads'],
        ['instagram', 'Instagram'], ['https://instagram.com', 'Instagram'], ['TikTok', 'TikTok'],
        ['newsletter', 'Email'], ['organic', 'Organic Search'], ['  Custom Source  ', 'Custom Source'],
        ['notgoogle.example.com', 'notgoogle.example.com'],
    ])('normalizes %j without inventing paid attribution', (source, expected) => {
        expect(normalizeSource(source)).toBe(expected);
    });
    it('uses explicit campaign medium evidence rather than only provider names', () => {
        expect(normalizeSource('google', 'cpc')).toBe('Google Ads');
        expect(normalizeSource('google', 'organic')).toBe('Organic Search');
        expect(normalizeSource('facebook', 'paid_social')).toBe('Meta Ads');
        expect(normalizeSource('https://google.com/?utm_medium=cpc')).toBe('Google Ads');
        expect(normalizeSource('https://google.com/?utm_medium=organic')).toBe('Organic Search');
    });
});
describe('category inference', () => {
    it.each([
        ['Spring collection', 'Other'], ['Ring binder', 'Rings'], ['Silver rings', 'Rings'], ['Personalised NECKLACES', 'Necklaces'],
        ['Gold pendants', 'Necklaces'], ['Bangles', 'Bracelets'], ['Hoops and studs', 'Earrings'], ['Smart watches', 'Watches'],
        ['Chainmail material', 'Other'], ['', 'Other'], ['Rose-gold earrings', 'Earrings'],
    ])('matches category words rather than arbitrary substrings: %s', (name, expected) => {
        expect(inferCategory(name)).toBe(expected);
    });
});
