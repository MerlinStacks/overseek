import type { EmailBlock, EmailDesignV2Envelope } from '../../../lib/emailDesignerV2';
export function moveEmailBlock(design: EmailDesignV2Envelope, blockId: string, direction: -1 | 1): boolean {
    const columns = design.document.sections.flatMap(section => section.columns);
    for (let index = 0; index < columns.length; index++) {
        const blocks = columns[index].blocks; const position = blocks.findIndex(block => block.id === blockId);
        if (position < 0 || blocks[position].type === 'footer') continue;
        const next = position + direction;
        if (next >= 0 && next < blocks.length) { [blocks[position], blocks[next]] = [blocks[next], blocks[position]]; return true; }
        const target = columns[index + direction]; if (!target) return false;
        const [block] = blocks.splice(position, 1); if (direction === -1) target.blocks.push(block); else target.blocks.unshift(block);
        return true;
    }
    return false;
}
const styleKeys = new Set(['align', 'padding', 'color', 'backgroundColor', 'borderColor', 'borderRadius', 'fontSize', 'fontWeight', 'fontStyle', 'textDecoration', 'size', 'lineHeight']);
export function copyEmailBlockStyles(block: EmailBlock): Record<string, unknown> { return Object.fromEntries(Object.entries(block.props).filter(([key]) => styleKeys.has(key))); }
