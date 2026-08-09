import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import { prisma } from '../../utils/prisma';
import { createPinnedLookup } from './pinnedLookup';

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

function blockedAddress(address: string): boolean {
    if (net.isIPv4(address)) {
        const parts = address.split('.').map(Number);
        return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] === 169 && parts[1] === 254
            || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168
            || parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2)
            || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127 || parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19
            || parts[0] === 198 && parts[1] === 51 && parts[2] === 100 || parts[0] === 203 && parts[1] === 0 && parts[2] === 113
            || parts[0] >= 224 || address === '100.100.100.200';
    }
    const normalized = address.toLowerCase().split('%')[0];
    if (normalized.startsWith('::ffff:')) return blockedAddress(normalized.slice(7));
    return !(normalized.startsWith('2') || normalized.startsWith('3')) || normalized.startsWith('2001:db8:');
}

export async function validatePublicHomepageUrl(rawUrl: string) {
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new Error('Store homepage URL is invalid'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Store homepage URL is unsupported');
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata.google.internal') throw new Error('Store homepage host is blocked');
    const addresses = net.isIP(hostname)
        ? [{ address: hostname, family: net.isIP(hostname) }]
        : await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(item => blockedAddress(item.address))) throw new Error('Store homepage address is blocked');
    return { url, address: addresses[0].address, family: addresses[0].family };
}

async function fetchHomepage(rawUrl: string, deadline: number, redirects = 0): Promise<{ html: string; finalUrl: URL; sources: string[] }> {
    if (redirects > MAX_REDIRECTS) throw new Error('Store homepage redirected too many times');
    if (Date.now() >= deadline) throw new Error('Store homepage request timed out');
    const resolved = await validatePublicHomepageUrl(rawUrl);
    return new Promise((resolve, reject) => {
        const transport = resolved.url.protocol === 'https:' ? https : http;
        const request = transport.get(resolved.url, {
            headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Overseek-Branding-Review/1.0' },
            lookup: createPinnedLookup(resolved.address, resolved.family),
            timeout: Math.min(TIMEOUT_MS, Math.max(1, deadline - Date.now())),
        }, response => {
            const status = response.statusCode || 0;
            if (status >= 300 && status < 400 && response.headers.location) {
                response.resume();
                const next = new URL(response.headers.location, resolved.url).toString();
                fetchHomepage(next, deadline, redirects + 1).then(result => resolve({ ...result, sources: [resolved.url.toString(), ...result.sources] }), reject);
                return;
            }
            const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (status !== 200 || !['text/html', 'application/xhtml+xml'].includes(type)) {
                response.resume(); reject(new Error('Store homepage response was not HTML')); return;
            }
            if (Number(response.headers['content-length'] || 0) > MAX_BYTES) {
                response.destroy(); reject(new Error('Store homepage exceeds size limit')); return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_BYTES) response.destroy(new Error('Store homepage exceeds size limit'));
                else chunks.push(Buffer.from(chunk));
            });
            response.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: resolved.url, sources: [resolved.url.toString()] }));
            response.on('error', reject);
        });
        request.on('timeout', () => request.destroy(new Error('Store homepage request timed out')));
        request.on('error', reject);
    });
}

function decodeEntities(value: string) {
    return value.replace(/&(?:amp|quot|#39|lt|gt);/g, entity => ({ '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' })[entity] || '');
}

function cleanText(value: unknown, maximum = 300) {
    return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, maximum);
}

function attributes(tag: string) {
    const result: Record<string, string> = {};
    for (const match of tag.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return result;
}

function candidateUrl(value: string | undefined, baseUrl: URL) {
    if (!value) return null;
    try {
        const url = new URL(value, baseUrl);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
    } catch { return null; }
}

export function parseBrandingCandidates(html: string, baseUrl: URL, appearance: unknown = {}) {
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const logos = new Set<string>();
    const colours = new Set<string>();
    const names = new Set<string>();
    const contacts = new Set<string>();
    const addLogo = (value?: string) => { const url = candidateUrl(value, baseUrl); if (url) logos.add(url); };
    for (const match of markup.matchAll(/<(?:meta|link|img)\b[^>]*>/gi)) {
        const attrs = attributes(match[0]);
        const marker = `${attrs.property || ''} ${attrs.name || ''} ${attrs.rel || ''} ${attrs.id || ''} ${attrs.class || ''}`.toLowerCase();
        if (/og:image|favicon|apple-touch|site-logo|custom-logo|\bicon\b|\blogo\b/.test(marker)) addLogo(attrs.content || attrs.href || attrs.src);
        if ((attrs.name || '').toLowerCase() === 'theme-color' && /^#[0-9a-f]{6}$/i.test(attrs.content || '')) colours.add(attrs.content.toUpperCase());
        if (/og:site_name|application-name/.test(marker)) { const text = cleanText(attrs.content); if (text) names.add(text); }
        if (/contact|email|phone|telephone|address/.test(marker)) { const text = cleanText(attrs.content); if (text) contacts.add(text); }
    }
    const title = cleanText(markup.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
    if (title) names.add(title);
    const css = [...markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), ...markup.matchAll(/\bstyle\s*=\s*["']([^"']*)["']/gi)].map(match => match[1]).join('\n');
    for (const match of css.matchAll(/#[0-9a-fA-F]{6}\b/g)) colours.add(match[0].toUpperCase());
    for (const match of markup.matchAll(/(?:mailto:|tel:)([^"'\s<>]+)/gi)) { const text = cleanText(match[1], 200); if (text) contacts.add(text); }
    const source = appearance && typeof appearance === 'object' ? appearance as Record<string, unknown> : {};
    addLogo(typeof source.logoUrl === 'string' ? source.logoUrl : typeof source.logo === 'string' ? source.logo : undefined);
    for (const value of Object.values(source)) {
        if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) colours.add(value.toUpperCase());
    }
    for (const [key, value] of Object.entries(source)) {
        if (typeof value !== 'string') continue;
        const text = cleanText(value);
        if (/business|company|store.?name/i.test(key) && text) names.add(text);
        if (/contact|email|phone|telephone|address/i.test(key) && text) contacts.add(text);
    }
    return {
        logoUrls: [...logos].slice(0, 20),
        colors: [...colours].slice(0, 20),
        businessNames: [...names].slice(0, 10),
        contactHints: [...contacts].slice(0, 20),
    };
}

export class WholesaleBrandingImportService {
    static async importCandidates(accountId: string) {
        const account = await (prisma as any).account.findUnique({ where: { id: accountId }, select: { wooUrl: true, appearance: true, name: true } });
        if (!account?.wooUrl) throw new Error('Store homepage is not configured');
        const fetched = await fetchHomepage(account.wooUrl, Date.now() + TIMEOUT_MS);
        const candidates = parseBrandingCandidates(fetched.html, fetched.finalUrl, account.appearance);
        if (account.name) candidates.businessNames = [...new Set([cleanText(account.name), ...candidates.businessNames])].filter(Boolean).slice(0, 10);
        const publicLogos: string[] = [];
        for (const logo of candidates.logoUrls) {
            try { await validatePublicHomepageUrl(logo); publicLogos.push(logo); } catch { /* Exclude private or unresolved candidates. */ }
        }
        return { candidates: { ...candidates, logoUrls: publicLogos }, sourceUrls: [...new Set(fetched.sources)] };
    }
}
