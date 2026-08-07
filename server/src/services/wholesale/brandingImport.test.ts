import { describe, expect, it } from 'vitest';
import { parseBrandingCandidates, validatePublicHomepageUrl } from './brandingImport';

describe('wholesale branding import security and parser', () => {
    it('blocks private and metadata addresses', async () => {
        await expect(validatePublicHomepageUrl('http://127.0.0.1/')).rejects.toThrow(/blocked/);
        await expect(validatePublicHomepageUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/blocked/);
        await expect(validatePublicHomepageUrl('http://metadata.google.internal/')).rejects.toThrow(/blocked/);
    });

    it('extracts review-only metadata without executing or treating scripts as CSS', () => {
        const result = parseBrandingCandidates(`
            <title> Example &amp; Co </title>
            <meta property="og:image" content="/media/logo.png">
            <meta name="theme-color" content="#123abc">
            <link rel="apple-touch-icon" href="https://cdn.example.test/icon.png">
            <style>:root { --brand: #AABBCC; }</style>
            <a href="mailto:sales@example.test">Contact</a>
            <script>window.location='http://127.0.0.1'; const fake = '#FFFFFF';</script>
        `, new URL('https://shop.example.test/'));
        expect(result).toEqual({
            logoUrls: ['https://shop.example.test/media/logo.png', 'https://cdn.example.test/icon.png'],
            colors: ['#123ABC', '#AABBCC'], businessNames: ['Example & Co'], contactHints: ['sales@example.test'],
        });
    });

    it('rejects executable and credential-bearing logo candidates', () => {
        const result = parseBrandingCandidates('<meta property="og:image" content="javascript:alert(1)"><img class="site-logo" src="https://user:pass@example.test/logo.png">', new URL('https://shop.example.test'));
        expect(result.logoUrls).toEqual([]);
    });
});
