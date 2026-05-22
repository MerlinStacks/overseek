const ALLOWED_TAGS = new Set(['a', 'b', 'br', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'i', 'li', 'ol', 'p', 'span', 'strong', 'u', 'ul']);
const BLOCK_TAGS = new Set(['div', 'h1', 'h2', 'h3', 'li', 'ol', 'p', 'ul']);
const ALLOWED_STYLES = new Set(['color', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height', 'text-align', 'text-decoration']);
const SAFE_URL_PATTERN = /^(https?:|mailto:|tel:|#|{{)/i;

export function sanitizeEmailHtml(html: string): string {
    const withoutBidi = stripBidiControls(html || '');
    if (typeof document === 'undefined') return sanitizeEmailHtmlFallback(withoutBidi);

    const template = document.createElement('template');
    template.innerHTML = withoutBidi;
    sanitizeNode(template.content);
    normalizeNestedTextBlocks(template.content);
    return template.innerHTML.trim();
}

export function sanitizeEmailPaste(html: string, plainText = ''): string {
    const source = html.trim() || plainTextToHtml(plainText);
    return sanitizeEmailHtml(source);
}

export function stripBidiControls(value: string): string {
    return value.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, '');
}

export function getEmailDesignWarnings(design: { document: { sections: Array<{ id: string; name?: string; visibility?: string; columns: Array<{ id: string; blocks: Array<{ id: string; type: string; visibility?: string; props: Record<string, unknown> }> }> }> } }): Array<{ id: string; message: string }> {
    const warnings: Array<{ id: string; message: string }> = [];

    design.document.sections.forEach((section, sectionIndex) => {
        const sectionLabel = section.name || `Section ${sectionIndex + 1}`;
        if (section.visibility !== 'mobile' && section.columns.length > 1 && section.columns.every((column) => column.blocks.length === 0)) {
            warnings.push({ id: `empty-section-${section.id}`, message: `${sectionLabel} has no content.` });
        }

        section.columns.forEach((column, columnIndex) => {
            column.blocks.forEach((block) => {
                const props = block.props || {};
                if (block.type === 'image' && !String(props.alt || '').trim()) warnings.push({ id: `alt-${block.id}`, message: `Image in ${sectionLabel}, column ${columnIndex + 1} is missing alt text.` });
                if (block.type === 'button' && !String(props.href || '').trim()) warnings.push({ id: `button-link-${block.id}`, message: `Button in ${sectionLabel} has no URL.` });
                if (block.type === 'text' && /<script|on\w+=|javascript:/i.test(String(props.html || ''))) warnings.push({ id: `unsafe-text-${block.id}`, message: `Text block in ${sectionLabel} contains unsafe pasted markup that will be removed.` });
                if (block.visibility === 'mobile' && section.visibility === 'desktop') warnings.push({ id: `hidden-${block.id}`, message: `A mobile-only block is inside a desktop-only ${sectionLabel}.` });
                if (block.visibility === 'desktop' && section.visibility === 'mobile') warnings.push({ id: `hidden-${block.id}`, message: `A desktop-only block is inside a mobile-only ${sectionLabel}.` });
            });
        });
    });

    return warnings;
}

function sanitizeNode(root: ParentNode): void {
    Array.from(root.childNodes).forEach((node) => {
        if (node.nodeType === Node.COMMENT_NODE) {
            node.remove();
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            node.textContent = stripBidiControls(node.textContent || '');
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            node.remove();
            return;
        }

        const element = node as HTMLElement;
        const tagName = element.tagName.toLowerCase();
        if (!ALLOWED_TAGS.has(tagName)) {
            if (tagName === 'script' || tagName === 'style') {
                element.remove();
                return;
            }
            element.replaceWith(...Array.from(element.childNodes));
            sanitizeNode(root);
            return;
        }

        Array.from(element.attributes).forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            if (name.startsWith('on') || name === 'class' || name === 'id' || name === 'dir') {
                element.removeAttribute(attribute.name);
                return;
            }
            if (tagName === 'a' && name === 'href') {
                const href = attribute.value.trim();
                if (!SAFE_URL_PATTERN.test(href)) element.removeAttribute(attribute.name);
                return;
            }
            if (tagName === 'a' && (name === 'target' || name === 'rel' || name === 'title')) return;
            if (name === 'style') {
                const style = sanitizeStyle(attribute.value);
                if (style) element.setAttribute('style', style);
                else element.removeAttribute('style');
                return;
            }
            element.removeAttribute(attribute.name);
        });

        if (tagName === 'a' && element.getAttribute('target') === '_blank' && !element.getAttribute('rel')) {
            element.setAttribute('rel', 'noopener noreferrer');
        }

        sanitizeNode(element);
    });
}

function sanitizeStyle(value: string): string {
    return value.split(';').map((declaration) => {
        const [rawProperty, ...rawValueParts] = declaration.split(':');
        const property = rawProperty?.trim().toLowerCase();
        const rawValue = rawValueParts.join(':').trim();
        if (!property || !rawValue || !ALLOWED_STYLES.has(property)) return '';
        if (/url\s*\(|expression\s*\(|javascript:/i.test(rawValue)) return '';
        return `${property}:${rawValue}`;
    }).filter(Boolean).join(';');
}

function normalizeNestedTextBlocks(root: ParentNode): void {
    Array.from(root.querySelectorAll('p p,p h1,p h2,p h3,h1 p,h2 p,h3 p,h1 h1,h1 h2,h1 h3,h2 h1,h2 h2,h2 h3,h3 h1,h3 h2,h3 h3')).forEach((node) => {
        const element = node as HTMLElement;
        const parent = element.parentElement;
        if (!parent || !BLOCK_TAGS.has(parent.tagName.toLowerCase())) return;
        parent.after(element);
    });
}

function plainTextToHtml(text: string): string {
    return stripBidiControls(text || '').split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
}

function sanitizeEmailHtmlFallback(html: string): string {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+=(['"]).*?\1/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/\sdir=(['"])rtl\1/gi, '')
        .trim();
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] || char));
}
