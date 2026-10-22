import { describe, expect, it } from 'vitest';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { compileEmailDesignV2, createDefaultEmailDesignV2, sanitizeEmailHtml, sanitizeEmailLayoutHtml, resolveEmailConditionBlocks } from '@overseek/core';
import { prepareEmail, readPreparedEmail } from './EmailPreparation';

const input = { html: '<p>Hello café 👋</p><a href="https://shop.test/p?a=1&amp;b=2">Shop</a><a href="{{unsubscribe_url}}">Unsubscribe</a>', subject: 'Café & gifts 👋', trackingId: 'recipient-id', apiUrl: 'https://api.test', category: 'MARKETING' as const };
describe('prepared delivery artifact', () => {
    it('decodes HTML entities before click tracking and preserves preference links outside tracking', () => {
        const prepared = prepareEmail(input);
        expect(prepared.html).toContain(encodeURIComponent('https://shop.test/p?a=1&b=2'));
        expect(prepared.html).toContain('href="https://api.test/api/email/unsubscribe/recipient-id"');
        expect(prepared.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
        expect(prepared.text).not.toContain('/track/');
    });
    it('verifies hashes after JSONB-style key reordering and rejects tampering', () => {
        const prepared = prepareEmail(input);
        const reordered = Object.fromEntries(Object.entries(prepared).reverse());
        expect(readPreparedEmail(reordered)).toEqual(prepared);
        expect(() => readPreparedEmail({ ...prepared, html: '<p>Different</p>' })).toThrow('integrity');
    });
    it('preserves compiled responsive styles and Outlook conditionals through final preparation', () => {
        const design = createDefaultEmailDesignV2({ title: input.subject });
        const prepared = prepareEmail({ ...input, html: compileEmailDesignV2(design) });
        expect(prepared.html).toContain('<!--[if mso]>'); expect(prepared.html).toContain('@media only screen');
        expect(prepared.html).toContain('mso-padding-alt');
    });
    it('keeps transactional unsubscribe links functional without marketing headers', () => {
        const prepared = prepareEmail({ ...input, category: 'TRANSACTIONAL' });
        expect(prepared.headers).toEqual({}); expect(prepared.html).toContain('/unsubscribe/recipient-id');
    });
    it('captures real generated MIME and round-trips HTML, plain text, unicode and headers without transport', async () => {
        const prepared = prepareEmail(input);
        const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
        const sent = await transport.sendMail({ from: 'Store <store@example.com>', to: 'qa@example.com', subject: prepared.subject, html: prepared.html, text: prepared.text, headers: prepared.headers });
        const message = await simpleParser(sent.message as Buffer);
        expect(message.subject).toBe(prepared.subject);
        expect(String(message.html).replace(/\r\n/g, '\n').trim()).toBe(prepared.html.replace(/\r\n/g, '\n').trim());
        expect(message.text?.trim()).toBe(prepared.text.trim());
        expect(message.headerLines).toContainEqual({ key: 'list-unsubscribe-post', line: 'List-Unsubscribe-Post: List-Unsubscribe=One-Click' });
        transport.close();
    });
});
describe('shared compiler and sanitation contract', () => {
    it('is deterministic and never resolves relative links against a browser origin', () => {
        const design = createDefaultEmailDesignV2();
        design.document.sections[1].columns[0].blocks = [{ id: 'cta', type: 'button', props: { label: 'Open', href: '/products' } }];
        expect(compileEmailDesignV2(design)).toContain('href="{{store_url}}/products"');
        expect(compileEmailDesignV2(design)).toBe(compileEmailDesignV2(structuredClone(design)));
    });
    it('removes executable content and unsafe CSS while keeping supported rich text/tables', () => {
        expect(sanitizeEmailHtml('<p onclick="bad()">Hello <strong>world</strong><script>bad()</script></p>')).toBe('<p>Hello <strong>world</strong></p>');
        const layout = sanitizeEmailLayoutHtml('<table><tr><td style="padding:12px;background:url(javascript:x)"><img src="https://cdn.test/a.png" onerror="bad()" /></td></tr></table>');
        expect(layout).toContain('padding:12px'); expect(layout).not.toMatch(/onerror|javascript/); expect(layout).toContain('<table>');
    });
    it('rejects unsupported renderer versions and CSS injection in document properties', () => {
        const design = createDefaultEmailDesignV2();
        expect(() => compileEmailDesignV2({ ...design, rendererVersion: 'future-unknown' })).toThrow();
        design.document.theme.primaryColor = 'red;position:fixed';
        expect(() => compileEmailDesignV2(design)).toThrow();
    });
    it('resolves nested conditions safely without eval or raw condition tokens', () => {
        const template = '{{#if customer.vip}}VIP {{#if customer.total > 100}}Gold{{else}}Silver{{/if}}{{else}}Standard{{/if}}';
        expect(resolveEmailConditionBlocks(template, { customer: { vip: true, total: 200 } })).toBe('VIP Gold');
        expect(resolveEmailConditionBlocks(template, { customer: { vip: false } })).toBe('Standard');
        expect(() => resolveEmailConditionBlocks('{{#if process.exit()}}Bad{{/if}}', {})).toThrow();
    });
});
