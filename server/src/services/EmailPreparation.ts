import { createHash } from 'crypto';
import { EMAIL_RENDERER_VERSION, decodeEmailHref } from '@overseek/core';
import { ensureEmailDocument, emailPlainText } from '../utils/emailContent';

export interface PreparedEmail {
    version: 1; rendererVersion: string; subject: string; html: string; text: string;
    headers: Record<string, string>; assets: string[]; hash: string;
}
function canonical(value: any): any { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value; }
function digest(value: Omit<PreparedEmail, 'hash'>) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

/** Pure final delivery transforms. Preview uses inert IDs, transport uses the
 * persisted recipient tracking ID. Neither path rewrites styles afterwards. */
export function prepareEmail(input: { html: string; subject: string; trackingId: string; apiUrl: string; listId?: string; category: 'MARKETING' | 'TRANSACTIONAL' }): PreparedEmail {
    const base = input.apiUrl.replace(/\/+$/, '');
    const id = encodeURIComponent(input.trackingId);
    const unsubscribe = `${base}/api/email/unsubscribe/${id}`;
    const preferences = unsubscribe;
    const list = input.listId ? `${base}/api/email/unsubscribe-list/${id}/${encodeURIComponent(input.listId)}` : preferences;
    let html = ensureEmailDocument(input.html).replace(/(?:https?:\/\/)?(?:\{\{|%7B%7B)\s*(unsubscribe_url|unsubscribe_list_url|preferences_url)\s*(?:\}\}|%7D%7D)\/?/gi, (_match, tag) => `{{${tag.toLowerCase()}}}`);
    html = html.replace(/<a\b([^>]*?)href=("|')(https?:\/\/[^"']+)(\2)([^>]*)>/gi, (match, before, quote, href, _end, after) => href.includes('{{') || href.includes('}}') || /\/api\/email\/(?:unsubscribe|preferences)/i.test(href) ? match : `<a${before}href=${quote}${base}/api/email/click/${id}?url=${encodeURIComponent(decodeEmailHref(href, quote))}${quote}${after}>`);
    html = html.replace(/\{\{unsubscribe_url\}\}/g, () => unsubscribe).replace(/\{\{preferences_url\}\}/g, () => preferences).replace(/\{\{unsubscribe_list_url\}\}/g, () => list);
    const pixel = `<img src="${base}/api/email/track/${id}.png" width="1" height="1" style="display:none" alt="" />`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${pixel}</body>`) : html + pixel;
    const headers: Record<string, string> = input.category === 'MARKETING' ? { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {};
    const assets = [...new Set([...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]).filter(url => !url.includes('/api/email/track/')))];
    const value: Omit<PreparedEmail, 'hash'> = { version: 1, rendererVersion: EMAIL_RENDERER_VERSION, subject: input.subject, html, text: emailPlainText(html), headers, assets };
    return { ...value, hash: digest(value) };
}

export function readPreparedEmail(value: unknown): PreparedEmail | null {
    if (!value) return null;
    const prepared = value as PreparedEmail;
    if (prepared.version !== 1 || typeof prepared.html !== 'string' || typeof prepared.text !== 'string' || typeof prepared.subject !== 'string' || !Array.isArray(prepared.assets) || !prepared.headers || typeof prepared.rendererVersion !== 'string') throw new Error('Stored prepared email is invalid');
    const { hash, ...artifact } = prepared;
    if (hash !== digest(artifact)) throw new Error('Stored prepared email failed its integrity check');
    return prepared;
}
