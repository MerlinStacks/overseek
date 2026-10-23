import DOMPurify from 'dompurify';
import { createDefaultEmailDesignV2, createEmailDesignId, type EmailBlock, type EmailSection } from './emailDesignerV2';
import { sanitizeEmailHtml, sanitizeEmailLayoutHtml } from '../utils/emailHtml';

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

    // Native sections cannot represent arbitrary nested-table spacing, borders,
    // rounded panels or stylesheet rules. Flattening these layouts is destructive:
    // ancestor padding gets repeated and a shell's align="center" becomes text
    // alignment. Keep the layout together instead of promising editable fidelity.
    const tables = Array.from(body.querySelectorAll<HTMLTableElement>('table'));
    const needsLayoutPreservation = !doc.querySelector('.os-email-section')
        && tables.some(table => table.querySelector('table'))
        && (Boolean(doc.querySelector('style')) || tables.some(table =>
            Boolean(table.style.margin || table.style.borderRadius)
            || Array.from(table.rows).some(row => Array.from(row.cells).some(cell =>
                Boolean(cell.style.borderTop || cell.style.borderBottom)
                || Boolean(cell.style.borderRadius && !cell.querySelector('a:only-child'))))));
    if (needsLayoutPreservation) {
        const preheader = Array.from(body.children).find(element => element instanceof HTMLElement && element.style.display === 'none');
        if (options?.previewText === undefined && preheader?.textContent?.trim()) design.document.meta.previewText = preheader.textContent.trim();
        // The compiler emits its own hidden preheader. Never turn the original
        // hidden content into visible blocks when sanitation removes attributes.
        body.querySelectorAll<HTMLElement>('[hidden], [style]').forEach(element => {
            if (element.hidden || element.style.display === 'none') element.remove();
        });
        const container = tables.find(table => /px$/.test(table.style.maxWidth) && parseFloat(table.style.maxWidth) >= 320 && parseFloat(table.style.maxWidth) <= 1200);
        if (container) theme.contentWidth = parseFloat(container.style.maxWidth);
        theme.borderRadius = 0;
        theme.contentBackgroundColor = body.style.backgroundColor || '#ffffff';
        design.document.sections = [{
            id: createEmailDesignId('section'), name: 'Imported HTML layout', padding: '0',
            columns: [{ id: createEmailDesignId('column'), width: 100, padding: '0', blocks: [{
                id: createEmailDesignId('block'), type: 'rawHtml', props: {
                    padding: '0',
                    html: sanitizeEmailLayoutHtml(body.innerHTML),
                    migrationWarning: 'Imported table layout retained as one HTML block to preserve inline formatting. Edit its HTML rather than individual visual blocks. Custom stylesheet and mobile rules are not retained; use Raw HTML to keep the original document.',
                },
            }] }],
        }];
        return design;
    }

    const inheritedStyle = (element: HTMLElement, property: string): string => {
        for (let current: HTMLElement | null = element; current; current = current.parentElement) {
            const value = current.style.getPropertyValue(property);
            if (value) return value;
        }
        return '';
    };
    const alignment = (element: HTMLElement): 'left' | 'center' | 'right' => {
        for (let current: HTMLElement | null = element; current; current = current.parentElement) {
            const value = current.style.textAlign || current.getAttribute('align');
            if (value === 'left' || value === 'center' || value === 'right') return value;
        }
        return 'left';
    };
    const isHidden = (element: HTMLElement) => element.hidden || element.style.display === 'none';
    // The designer supports up to four columns, but not row/column spans or data tables.
    const canImportTable = (table: HTMLTableElement) => !table.querySelector('th,caption')
        && Array.from(table.rows).every(row => row.cells.length <= 4
            && Array.from(row.cells).every(cell => cell.colSpan === 1 && cell.rowSpan === 1));
    const sectionName = (blocks: EmailBlock[]) => {
        const text = blocks.find(block => block.type === 'text');
        const label = text?.type === 'text' ? new DOMParser().parseFromString(text.props.html, 'text/html').body.textContent?.trim() : '';
        return label?.slice(0, 60) || (blocks[0]?.type === 'image' ? 'Image' : blocks[0]?.type === 'button' ? 'Button' : 'Content');
    };

    const blocksFrom = (root: HTMLElement, includeRoot = false): EmailBlock[] => {
        const blocks: EmailBlock[] = [];
        const visit = (node: Node, inheritedAlign = alignment(root)) => {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.textContent?.trim()) blocks.push({ id: createEmailDesignId('text'), type: 'text', props: { html: sanitizeEmailHtml(node.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;')), padding: '0', align: inheritedAlign as 'left' | 'center' | 'right' } });
                return;
            }
            if (!(node instanceof HTMLElement) || ['STYLE', 'SCRIPT', 'META', 'TITLE'].includes(node.tagName)) return;
            // Hidden preheaders are represented by the editor's preview-text field.
            if (isHidden(node)) return;
            const style = node.style;
            const align = alignment(node);
            const id = createEmailDesignId('block');
            const image = node.tagName === 'IMG' ? node as HTMLImageElement : node.tagName === 'A' && !node.textContent?.trim() && node.querySelectorAll('img').length === 1 ? node.querySelector('img') : null;
            if (image) {
                blocks.push({ id, type: 'image', props: { src: image.getAttribute('src') || '', alt: image.alt, width: parseFloat(image.getAttribute('width') || image.style.width) || undefined, href: node.tagName === 'A' ? node.getAttribute('href') || '' : undefined, align, padding: style.padding || '0' } });
            } else if (node.tagName === 'A' && (style.backgroundColor || style.background || node.parentElement?.tagName === 'TD' && node.parentElement.style.backgroundColor && node.parentElement.textContent?.trim() === node.textContent?.trim())) {
                blocks.push({ id, type: 'button', props: { label: node.textContent || '', href: node.getAttribute('href') || '', backgroundColor: style.backgroundColor || node.parentElement?.style.backgroundColor, color: inheritedStyle(node, 'color') || undefined, fontSize: parseFloat(inheritedStyle(node, 'font-size')) || undefined, borderRadius: parseFloat(style.borderRadius || node.parentElement?.style.borderRadius || '') || 0, padding: style.padding || node.parentElement?.style.padding || undefined, align } });
            } else if (node.tagName === 'HR') {
                blocks.push({ id, type: 'divider', props: { color: style.borderTopColor } });
            } else if (['UL', 'OL'].includes(node.tagName) && Array.from(node.children).every(item => item.tagName === 'LI' && !item.children.length)) {
                // List blocks store plain text. Keep rich lists as text blocks instead.
                blocks.push({ id, type: 'list', props: { items: Array.from(node.children).map(item => item.textContent || ''), ordered: node.tagName === 'OL', color: inheritedStyle(node, 'color') || undefined, padding: style.padding || '0' } });
            } else if (!node.textContent?.replace(/\u00a0/g, '').trim() && !node.children.length && parseFloat(style.height || node.getAttribute('height') || '') > 0) {
                blocks.push({ id, type: 'spacer', props: { height: parseFloat(style.height || node.getAttribute('height') || '') } });
            } else if (!['TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH'].includes(node.tagName) && !node.querySelector('table,img,hr,style,p,div,h1,h2,h3,h4,h5,h6,ul,ol,section,article') && !node.querySelector('a[style*="background"]')) {
                blocks.push({ id, type: 'text', props: { html: sanitizeEmailHtml(node.outerHTML), align, padding: style.padding || '0', color: inheritedStyle(node, 'color') || undefined, size: parseFloat(inheritedStyle(node, 'font-size')) || undefined } });
            } else if (node.tagName === 'TABLE' && (!canImportTable(node as HTMLTableElement) || Array.from((node as HTMLTableElement).rows).some(row => row.cells.length > 1))) {
                blocks.push({ id, type: 'rawHtml', props: { html: node.outerHTML, migrationWarning: 'Complex imported layout preserved as HTML.' } });
            } else {
                Array.from(node.childNodes).forEach(child => visit(child, align));
            }
        };
        if (includeRoot) visit(root);
        else Array.from(root.childNodes).forEach(child => visit(child));
        return blocks;
    };

    const sectionElements = Array.from(doc.querySelectorAll<HTMLElement>('.os-email-section'));
    const sections: EmailSection[] = sectionElements.map((element) => {
        const table = element.firstElementChild as HTMLTableElement | null;
        const row = table?.tagName === 'TABLE' ? table.rows[0] : null;
        const cells = row ? Array.from(row.cells) : [element];
        const columns = cells.map(cell => ({ id: createEmailDesignId('column'), width: parseFloat(cell.getAttribute('width') || '') || 100 / cells.length, padding: cell.style.padding || '0', blocks: blocksFrom(cell) }));
        return {
            id: createEmailDesignId('section'), name: sectionName(columns.flatMap(column => column.blocks)),
            padding: element.style.padding || '0', backgroundColor: element.style.backgroundColor || undefined,
            columns,
        };
    });
    const sectionFrom = (root: HTMLElement): EmailSection => {
        const blocks = blocksFrom(root, true);
        return {
            id: createEmailDesignId('section'), name: sectionName(blocks), padding: root.style.padding || '0',
            backgroundColor: root.style.backgroundColor || undefined,
            columns: [{ id: createEmailDesignId('column'), width: 100, blocks }],
        };
    };
    // Single-column wrapping tables are common in hand-written email HTML.
    // Unwrap those shells, but turn real multi-column rows into designer columns.
    const layoutFrom = (root: HTMLElement): EmailSection[] => {
        if (isHidden(root) || ['STYLE', 'SCRIPT', 'META', 'TITLE'].includes(root.tagName)) return [];
        const children = Array.from(root.children) as HTMLElement[];
        const hasDirectText = Array.from(root.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
        const table = root.tagName === 'TABLE' ? root as HTMLTableElement
            : !hasDirectText && children.length === 1 && children[0].tagName === 'TABLE' ? children[0] as HTMLTableElement : null;
        if (!table) {
            // Descend through ordinary wrappers, preserving the order of text and layout rows.
            // Nested columns inside a column still use blocksFrom's HTML fallback.
            if (root.querySelector('table') && !hasDirectText) return children.flatMap(child => layoutFrom(child));
            return [sectionFrom(root)];
        }
        if (!canImportTable(table)) return [{
            id: createEmailDesignId('section'), name: 'HTML content', padding: '0',
            columns: [{ id: createEmailDesignId('column'), width: 100, blocks: [{ id: createEmailDesignId('block'), type: 'rawHtml', props: { html: table.outerHTML, migrationWarning: 'Complex imported layout preserved as HTML.' } }] }],
        }];
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
                id: createEmailDesignId('section'), name: sectionName(blocksFrom(cells[0])), padding: '0',
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
