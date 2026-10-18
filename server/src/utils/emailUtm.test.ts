import { describe, expect, it } from 'vitest';
import { appendEmailUtm } from './emailUtm';

describe('email UTM tagging', () => {
    it('adds all configured parameters while preserving query strings, fragments and existing UTM values', () => {
        const result = appendEmailUtm('<a href="https://store.test/sale?product=1&amp;utm_source=manual#details">Shop</a>', {
            campaignSource: 'newsletter', campaignMedium: 'email', campaignName: 'Spring sale', campaignTerm: 'VIP', campaignContent: 'Hero',
        }, 'flow-id');
        const href = result.match(/href="([^"]+)"/)![1].replace(/&amp;/g, '&');
        const url = new URL(href);
        expect(Object.fromEntries(url.searchParams)).toEqual({ product: '1', utm_source: 'manual', utm_medium: 'email', utm_campaign: 'Spring sale', utm_term: 'VIP', utm_content: 'Hero' });
        expect(url.hash).toBe('#details');
    });

    it.each(['mailto:help@store.test', 'tel:123', '#details', '{{unsubscribe_url}}', '{{preferences_url}}', 'https://app.test/email/unsubscribe/token', 'https://app.test/preferences/token', '/relative', 'https://store.test/{{link}}'])('does not tag special link %s', (href) => {
        const html = `<a href='${href}'>Link</a>`;
        expect(appendEmailUtm(html, {}, 'flow-id')).toBe(html);
    });

    it('honors disabling and defaults to a useful flow identity', () => {
        const html = '<a href="https://store.test/">Shop</a>';
        expect(appendEmailUtm(html, { appendUtm: false, campaignSource: 'ignored' }, 'flow-id')).toBe(html);
        expect(appendEmailUtm(html, {}, 'flow-id')).toContain('utm_source=overseek&amp;utm_medium=Email&amp;utm_campaign=flow-id');
    });

    it('tags unquoted hrefs without mistaking data-href for the actual link', () => {
        const html = '<a data-href="https://wrong.test" href=https://store.test/sale>Shop</a>';
        const result = appendEmailUtm(html, {}, 'flow-id');
        expect(result).toContain('data-href="https://wrong.test"');
        expect(result).toContain('href="https://store.test/sale?utm_source=overseek');
    });
});
