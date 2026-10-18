import DOMPurify from 'dompurify';
import { createDefaultEmailDesignV2, createEmailDesignId, type EmailBlock, type EmailSection } from './emailDesignerV2';
import { sanitizeEmailHtml } from '../utils/emailHtml';

/** Import supported content as editable blocks; retain complex markup as HTML blocks. */
export function importEmailHtml(html: string, options?: { title?: string; previewText?: string }) {
    const design = createDefaultEmailDesignV2(options);
    const doc = new DOMParser().parseFromString(DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, ADD_TAGS: ['style'] }), 'text/html');
    if (options?.title === undefined) design.document.meta.title = doc.title;
    const theme = design.document.theme;
    const body = doc.body;
    theme.backgroundColor = body.style.backgroundColor || theme.backgroundColor;
    theme.fontFamily = body.style.fontFamily || theme.fontFamily;
    theme.textColor = body.style.color || theme.textColor;
    const card = doc.querySelector<HTMLElement>('.os-email-card');
    if (card) {
        theme.contentWidth = parseFloat(card.style.maxWidth) || theme.contentWidth;
        theme.contentBackgroundColor = card.style.backgroundColor || theme.contentBackgroundColor;
        theme.borderRadius = parseFloat(card.style.borderRadius) || 0;
    }

    const blocksFrom = (root: HTMLElement): EmailBlock[] => {
        const blocks: EmailBlock[] = [];
        const visit = (node: Node, inheritedAlign = root.style.textAlign || root.getAttribute('align') || 'left') => {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.textContent?.trim()) blocks.push({ id: createEmailDesignId('text'), type: 'text', props: { html: sanitizeEmailHtml(node.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;')), padding: '0', align: inheritedAlign as 'left' | 'center' | 'right' } });
                return;
            }
            if (!(node instanceof HTMLElement) || ['STYLE', 'SCRIPT', 'META', 'TITLE'].includes(node.tagName)) return;
            // Hidden preheaders are represented by the editor's preview-text field.
            if (node.style.display === 'none' && parseFloat(node.style.maxHeight) === 0) return;
            const style = node.style;
            const align = (style.textAlign || node.getAttribute('align') || inheritedAlign) as 'left' | 'center' | 'right';
            const id = createEmailDesignId('block');
            const image = node.tagName === 'IMG' ? node as HTMLImageElement : !node.textContent?.trim() && node.children.length === 1 && node.firstElementChild?.tagName === 'IMG' ? node.firstElementChild as HTMLImageElement : null;
            if (image) {
                blocks.push({ id, type: 'image', props: { src: image.getAttribute('src') || '', alt: image.alt, width: parseFloat(image.getAttribute('width') || image.style.width) || undefined, href: node.tagName === 'A' ? node.getAttribute('href') || '' : undefined, align, padding: style.padding || '0' } });
            } else if (node.tagName === 'A' && (style.backgroundColor || style.background)) {
                blocks.push({ id, type: 'button', props: { label: node.textContent || '', href: node.getAttribute('href') || '', backgroundColor: style.backgroundColor, color: style.color, borderRadius: parseFloat(style.borderRadius) || 0, padding: style.padding || undefined, align } });
            } else if (node.tagName === 'HR') {
                blocks.push({ id, type: 'divider', props: { color: style.borderTopColor } });
            } else if (!['TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH'].includes(node.tagName) && !node.querySelector('table,img,hr,style') && !node.querySelector('a[style*="background"]')) {
                blocks.push({ id, type: 'text', props: { html: sanitizeEmailHtml(node.outerHTML), align, padding: style.padding || '0', color: style.color || undefined, size: parseFloat(style.fontSize) || undefined } });
            } else if (node.tagName === 'TABLE' && Array.from((node as HTMLTableElement).rows).some(row => row.cells.length > 1)) {
                blocks.push({ id, type: 'rawHtml', props: { html: node.outerHTML, migrationWarning: 'Complex imported layout preserved as HTML.' } });
            } else {
                Array.from(node.childNodes).forEach(child => visit(child, align));
            }
        };
        Array.from(root.childNodes).forEach(child => visit(child));
        return blocks;
    };

    const sectionElements = Array.from(doc.querySelectorAll<HTMLElement>('.os-email-section'));
    const sections: EmailSection[] = sectionElements.map((element, index) => {
        const table = element.firstElementChild as HTMLTableElement | null;
        const row = table?.tagName === 'TABLE' ? table.rows[0] : null;
        const cells = row ? Array.from(row.cells) : [element];
        return {
            id: createEmailDesignId('section'), name: `Imported section ${index + 1}`,
            padding: element.style.padding || '0', backgroundColor: element.style.backgroundColor || undefined,
            columns: cells.map(cell => ({ id: createEmailDesignId('column'), width: parseFloat(cell.getAttribute('width') || '') || 100 / cells.length, padding: cell.style.padding || '0', blocks: blocksFrom(cell) })),
        };
    });
    const sectionFrom = (root: HTMLElement): EmailSection => ({
        id: createEmailDesignId('section'), name: 'Imported email', padding: root.style.padding || '0',
        backgroundColor: root.style.backgroundColor || undefined,
        columns: [{ id: createEmailDesignId('column'), width: 100, blocks: blocksFrom(root) }],
    });
    // Single-column wrapping tables are common in hand-written email HTML.
    // Unwrap those shells, but turn real multi-column rows into designer columns.
    const layoutFrom = (root: HTMLElement): EmailSection[] => {
        const children = Array.from(root.children) as HTMLElement[];
        const hasDirectText = Array.from(root.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
        const table = root.tagName === 'TABLE' ? root as HTMLTableElement
            : !hasDirectText && children.length === 1 && children[0].tagName === 'TABLE' ? children[0] as HTMLTableElement : null;
        if (!table) return [sectionFrom(root)];
        const width = parseFloat(table.style.maxWidth || table.getAttribute('width') || '');
        if (width >= 320 && width <= 1200) theme.contentWidth = width;
        if (table.style.backgroundColor) theme.contentBackgroundColor = table.style.backgroundColor;
        return Array.from(table.rows).flatMap<EmailSection>(row => {
            const cells = Array.from(row.cells);
            if (cells.length === 1) {
                const cell = cells[0];
                const nested = layoutFrom(cell);
                return nested.map(section => ({ ...section, padding: cell.style.padding || section.padding, backgroundColor: cell.style.backgroundColor || section.backgroundColor }));
            }
            const weights = cells.map(cell => parseFloat(cell.getAttribute('width') || cell.style.width) || 100 / cells.length);
            const total = weights.reduce((sum, weight) => sum + weight, 0);
            return [{
                id: createEmailDesignId('section'), name: 'Imported row', padding: '0',
                columns: cells.map((cell, index) => ({
                    id: createEmailDesignId('column'), width: weights[index] / total * 100,
                    padding: cell.style.padding || '0', backgroundColor: cell.style.backgroundColor || undefined,
                    blocks: blocksFrom(cell),
                })),
            }];
        });
    };
    design.document.sections = sections.length ? sections : layoutFrom(body);
    return design;
}
