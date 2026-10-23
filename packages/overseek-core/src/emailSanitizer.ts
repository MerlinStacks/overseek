import { parseFragment, serialize } from 'parse5';

const textTags = new Set(['a', 'b', 'br', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'i', 'li', 'ol', 'p', 'span', 'strong', 'u', 'ul']);
const layoutTags = new Set([...textTags, 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'img', 'center', 'blockquote']);
const dropTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'video', 'audio']);
const textStyles = new Set(['color', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height', 'text-align', 'text-decoration', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']);
const layoutStyles = new Set([...textStyles, 'background', 'background-color', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-width', 'border-style', 'border-radius', 'border-collapse', 'border-spacing', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'display', 'vertical-align', 'overflow', 'opacity', 'white-space', 'word-break', 'overflow-wrap', 'letter-spacing', 'text-transform']);

export function stripEmailBidiControls(value: string): string {
    return value.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, '');
}

export function safeEmailUrl(value: string, image = false): string {
    const url = stripEmailBidiControls(value).trim();
    if (/[\u0000-\u0020\u007f]/.test(url) || /[<>"']/.test(url)) return '';
    if (/^\{\{[\w.]+(?:\s*\|\s*fallback:[^{}]+)?\}\}$/.test(url)) return url;
    if (url.startsWith('#')) return url;
    try { const parsed = new URL(url); return (image ? ['https:', 'cid:'] : ['https:', 'http:', 'mailto:', 'tel:']).includes(parsed.protocol) ? url : ''; }
    catch { return ''; }
}

/** One DOM-independent policy. User HTML cannot introduce CSS rules, active
 * content or Outlook conditional comments; those are emitted by the compiler. */
function sanitize(source: string, layout: boolean): string {
    const tree = parseFragment(stripEmailBidiControls(source || '')) as any;
    const allowed = layout ? layoutTags : textTags;
    const walk = (parent: any) => {
        const children: any[] = [];
        for (const node of parent.childNodes || []) {
            if (node.nodeName === '#text') { children.push(node); continue; }
            if (!node.tagName || dropTags.has(node.tagName)) continue;
            walk(node);
            if (!allowed.has(node.tagName)) { children.push(...(node.childNodes || [])); continue; }
            node.attrs = (node.attrs || []).filter((attribute: any) => {
                const name = attribute.name.toLowerCase();
                if (name === 'style') {
                    attribute.value = attribute.value.split(';').flatMap((declaration: string) => {
                        const colon = declaration.indexOf(':');
                        const property = declaration.slice(0, colon).trim().toLowerCase();
                        const value = declaration.slice(colon + 1).trim();
                        if (colon < 0 || !(layout ? layoutStyles : textStyles).has(property) || /url\s*\(|expression|javascript|[\\<>@{}]/i.test(value)) return [];
                        return `${property}:${value}`;
                    }).join(';');
                    return Boolean(attribute.value);
                }
                if (node.tagName === 'a' && name === 'href' || node.tagName === 'img' && name === 'src') { attribute.value = safeEmailUrl(attribute.value, name === 'src'); return !!attribute.value; }
                if (name === 'title' || node.tagName === 'img' && name === 'alt') return true;
                if (layout && ['width', 'height', 'colspan', 'rowspan', 'cellpadding', 'cellspacing', 'border'].includes(name)) return /^\d{1,4}%?$/.test(attribute.value);
                if (layout && ['align', 'valign', 'role', 'bgcolor'].includes(name)) return /^[\w#(),. %\-]+$/.test(attribute.value);
                return false;
            });
            children.push(node);
        }
        parent.childNodes = children;
        for (const child of children) child.parentNode = parent;
    };
    walk(tree);
    return serialize(tree).trim();
}

export function sanitizeEmailHtml(html: string): string { return sanitize(html, false); }
/** Inline the same text defaults for the canvas and mailboxes, without replacing
 * explicit imported formatting. A block size is an absolute heading size, not
 * a base to multiply by the browser's default heading scale. */
export function normalizeEmailTextHtml(html: string, explicitSize?: number): string {
    const tree = parseFragment(sanitizeEmailHtml(html)) as any;
    const headings: Record<string, [string, string]> = { h1: ['2em', '1.25'], h2: ['1.5em', '1.3'], h3: ['1.17em', '1.35'], h4: ['1em', '1.4'], h5: ['0.83em', '1.4'], h6: ['0.67em', '1.4'] };
    const walk = (parent: any) => {
        const elements = (parent.childNodes || []).filter((node: any) => node.tagName);
        for (const node of elements) {
            const heading = headings[node.tagName];
            if (heading || ['p', 'ul', 'ol'].includes(node.tagName)) {
                const style = node.attrs.find((attr: any) => attr.name === 'style') || { name: 'style', value: '' };
                const declarations = new Map<string, string>(style.value.split(';').filter(Boolean).map((value: string) => {
                    const colon = value.indexOf(':'); return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()];
                }));
                if (!Array.from(declarations.keys()).some(key => key === 'margin' || key.startsWith('margin-'))) declarations.set('margin', node === elements[elements.length - 1] ? '0' : '0 0 0.8em');
                if (heading) {
                    if (!declarations.has('font-size')) declarations.set('font-size', explicitSize ? 'inherit' : heading[0]);
                    if (!declarations.has('font-weight')) declarations.set('font-weight', '700');
                    if (!declarations.has('line-height')) declarations.set('line-height', heading[1]);
                }
                if (['ul', 'ol'].includes(node.tagName)) {
                    // List indentation is structural and emitted only by us.
                    declarations.set('padding-left', '1.4em');
                }
                style.value = Array.from(declarations, ([key, value]) => `${key}:${value}`).join(';');
                if (!node.attrs.includes(style)) node.attrs.push(style);
            }
            walk(node);
        }
    };
    walk(tree);
    return serialize(tree);
}
export function sanitizeEmailLayoutHtml(html: string): string { return sanitize(html, true); }
export function decodeEmailHref(value: string, quote = '"'): string {
    const tree = parseFragment(`<a href=${quote}${value}${quote}></a>`) as any;
    return tree.childNodes?.[0]?.attrs?.find((attribute: any) => attribute.name === 'href')?.value || value;
}
