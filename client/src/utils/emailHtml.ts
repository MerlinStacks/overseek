import { sanitizeEmailHtml, sanitizeEmailLayoutHtml, stripEmailBidiControls } from '@overseek/core';
export { sanitizeEmailHtml, sanitizeEmailLayoutHtml };
export const stripBidiControls = stripEmailBidiControls;

export function sanitizeEmailPaste(html: string, plainText = ''): string {
    return sanitizeEmailHtml(html.trim() || plainText.split(/\n{2,}/).map(paragraph => `<p>${paragraph.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]! ).replace(/\n/g, '<br>')}</p>`).join(''));
}

export interface EmailDesignWarning { id: string; message: string; sectionId?: string; blockId?: string; severity: 'warning' | 'blocking' }
export function getEmailDesignWarnings(design: { document: { theme?: { fontFamily?: string }; sections: Array<{ id: string; name?: string; visibility?: string; columns: Array<{ id: string; blocks: Array<{ id: string; type: string; visibility?: string; props: Record<string, unknown> }> }> }> } }): EmailDesignWarning[] {
    const warnings: EmailDesignWarning[] = [];
    design.document.sections.forEach((section, sectionIndex) => {
        const sectionLabel = section.name || `Section ${sectionIndex + 1}`;
        if (section.columns.every(column => column.blocks.length === 0)) warnings.push({ id: `empty-section-${section.id}`, sectionId: section.id, severity: 'warning', message: `${sectionLabel} has no content.` });
        section.columns.forEach((column, columnIndex) => column.blocks.forEach(block => {
            const props = block.props || {};
            const add = (key: string, message: string, severity: 'warning' | 'blocking' = 'warning') => warnings.push({ id: `${key}-${block.id}`, sectionId: section.id, blockId: block.id, severity, message });
            if (['image', 'siteLogo'].includes(block.type) && !String(props.alt || '').trim()) add('alt', `Image in ${sectionLabel}, column ${columnIndex + 1} is missing alt text.`);
            if (block.type === 'button' && !String(props.href || '').trim()) add('button-link', `Button in ${sectionLabel} has no URL.`, 'blocking');
            for (const [field, value] of Object.entries(props)) {
                if (!/^(?:src|productImage|href|productUrl)$/.test(field) || typeof value !== 'string' || !value.trim() || value.includes('{{')) continue;
                const image = field === 'src' || field === 'productImage';
                if (image && !/^https:\/\//i.test(value)) add(`asset-${field}`, `Image in ${sectionLabel} needs a durable public HTTPS URL. Upload it to Email Assets.`, 'blocking');
                if (image && /(?:[?&](?:expires?|signature|token|x-amz-|x-goog-)|\.svg(?:\?|$)|^blob:|^data:)/i.test(value)) add(`temporary-${field}`, `Image in ${sectionLabel} may expire or use an unsupported format. Publish a permanent raster asset.`, 'blocking');
                if (!image && !/^(?:https?:|mailto:|tel:|#)/i.test(value)) add(`relative-${field}`, `Link in ${sectionLabel} is relative; delivery resolves it against the storefront, never this app.`);
            }
            if (block.type === 'text' && /<script|on\w+=|javascript:/i.test(String(props.html || ''))) add('unsafe-text', `Text block in ${sectionLabel} contains unsafe pasted markup that will be removed.`);
            if (block.type === 'rawHtml') add('imported-html', `${sectionLabel}: ${String(props.migrationWarning || 'Imported HTML may not match every mailbox. Review Delivery preview.')}`);
            if (block.visibility === 'mobile' && section.visibility === 'desktop' || block.visibility === 'desktop' && section.visibility === 'mobile') add('hidden', `A block is hidden on both devices inside ${sectionLabel}.`, 'blocking');
        }));
    });
    if (design.document.theme?.fontFamily && !/Arial|Helvetica|Verdana|Georgia|Times|Tahoma|Trebuchet|sans-serif|serif/i.test(design.document.theme.fontFamily)) warnings.push({ id: 'font-fallback', severity: 'warning', message: 'Custom fonts are not supported in every inbox. Delivery adds Arial/Helvetica fallbacks.' });
    return warnings;
}
