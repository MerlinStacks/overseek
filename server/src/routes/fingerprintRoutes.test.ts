// @vitest-environment jsdom
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import routes from './fingerprintRoutes';
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function install() {
    const app = Fastify(); await app.register(routes);
    const response = await app.inject({ url: '/collect.js' }); await app.close();
    const script = document.createElement('script'); script.setAttribute('data-nonce', 'nonce'); vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script);
    const fetchMock = vi.fn().mockResolvedValue('ok'); vi.stubGlobal('fetch', fetchMock);
    new Function('window', 'document', 'navigator', 'screen', 'btoa', 'Headers', 'Request', 'URL', response.body)(window, document, navigator, screen, btoa, Headers, Request, URL);
    return fetchMock;
}
describe('checkout fingerprint collector', () => {
    it('handles dynamically mounted checkout forms and reuses one hidden input across retries', async () => {
        await install(); const form = document.createElement('form'); form.className = 'checkout'; document.body.appendChild(form);
        form.dispatchEvent(new Event('submit', { bubbles: true })); form.dispatchEvent(new Event('submit', { bubbles: true }));
        expect(form.querySelectorAll('input[name="_os_fp"]')).toHaveLength(1); expect(JSON.parse(atob((form.firstElementChild as HTMLInputElement).value))).toMatchObject({ n: 'nonce' });
    });
    it('supports URL and Request inputs, copies headers, and never tags unrelated or cross-origin requests', async () => {
        const original = await install();
        const url = new URL('/wp-json/wc/store/v1/checkout', location.href); const headers = new Headers({ 'X-Original': 'yes' });
        await window.fetch(url, { method: 'POST', headers }); expect(headers.has('X-OS-FP')).toBe(false); expect(original.mock.calls[0][1].headers.get('X-OS-FP')).toBeTruthy();
        await window.fetch(new Request(url.href, { method: 'POST' })); expect(original.mock.calls[1][1].headers.get('X-OS-FP')).toBeTruthy();
        const options = { method: 'POST' }; await window.fetch('https://example.invalid/wp-json/wc/store/v1/checkout', options); expect(original.mock.calls[2][1]).toBe(options);
        await window.fetch('/other?x=/wc/store/v1/checkout', options); expect(original.mock.calls[3][1]).toBe(options);
    });
});
