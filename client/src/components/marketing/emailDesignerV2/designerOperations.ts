import type { EmailBlock, EmailDesignV2Envelope } from '../../../lib/emailDesignerV2';

/** Indices are insertion boundaries in the original list, before removal. */
export function reorderEmailSection(design: EmailDesignV2Envelope, sectionId: string, targetIndex: number): boolean {
    const sections = design.document.sections;
    const source = sections.findIndex(section => section.id === sectionId);
    if (source < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > sections.length) return false;
    const next = targetIndex > source ? targetIndex - 1 : targetIndex;
    if (source === next) return false;
    const [section] = sections.splice(source, 1);
    sections.splice(next, 0, section);
    return true;
}

export function relocateEmailBlock(design: EmailDesignV2Envelope, blockId: string, sectionId: string, columnId: string, targetIndex: number): boolean {
    const target = design.document.sections.find(section => section.id === sectionId)?.columns.find(column => column.id === columnId);
    const source = design.document.sections.flatMap(section => section.columns).find(column => column.blocks.some(block => block.id === blockId));
    // Validate the destination before removing anything from the source.
    if (!target || !source || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > target.blocks.length) return false;
    const position = source.blocks.findIndex(block => block.id === blockId);
    const next = source === target && targetIndex > position ? targetIndex - 1 : targetIndex;
    if (source === target && next === position) return false;
    const [block] = source.blocks.splice(position, 1);
    target.blocks.splice(next, 0, block);
    return true;
}

export function moveEmailBlock(design: EmailDesignV2Envelope, blockId: string, direction: -1 | 1): boolean {
    const columns = design.document.sections.flatMap(section => section.columns.map(column => ({ sectionId: section.id, column })));
    for (let index = 0; index < columns.length; index++) {
        const { sectionId, column } = columns[index];
        const blocks = column.blocks; const position = blocks.findIndex(block => block.id === blockId);
        if (position < 0) continue;
        const next = position + direction;
        if (next >= 0 && next < blocks.length) return relocateEmailBlock(design, blockId, sectionId, column.id, next + (direction === 1 ? 1 : 0));
        const target = columns[index + direction]; if (!target) return false;
        return relocateEmailBlock(design, blockId, target.sectionId, target.column.id, direction === -1 ? target.column.blocks.length : 0);
    }
    return false;
}
const styleKeys = new Set(['align', 'padding', 'color', 'backgroundColor', 'borderColor', 'borderRadius', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'size', 'lineHeight']);
export function copyEmailBlockStyles(block: EmailBlock): Record<string, unknown> { return Object.fromEntries(Object.entries(block.props).filter(([key]) => styleKeys.has(key))); }
