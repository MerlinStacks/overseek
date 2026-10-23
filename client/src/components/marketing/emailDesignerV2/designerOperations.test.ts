import { describe, expect, it } from 'vitest';
import { createDefaultEmailDesignV2 } from '../../../lib/emailDesignerV2';
import { copyEmailBlockStyles, moveEmailBlock, relocateEmailBlock, reorderEmailSection } from './designerOperations';
describe('designer block operations', () => {
    it('moves across columns without losing identity or content', () => {
        const design = createDefaultEmailDesignV2();
        const section = design.document.sections[0];
        section.columns = [{ id: 'a', width: 50, blocks: [{ id: 'text', type: 'text', props: { html: '<p>Keep me</p>' } }] }, { id: 'b', width: 50, blocks: [] }];
        expect(moveEmailBlock(design, 'text', 1)).toBe(true);
        expect(section.columns[0].blocks).toEqual([]);
        expect(section.columns[1].blocks[0]).toMatchObject({ id: 'text', props: { html: '<p>Keep me</p>' } });
        expect(moveEmailBlock(design, 'text', -1)).toBe(true);
    });
    it('copies styles only, never content or destination URLs', () => {
        expect(copyEmailBlockStyles({ id: 'cta', type: 'button', props: { label: 'Buy', href: 'https://store.test', color: '#fff', padding: '8px' } })).toEqual({ color: '#fff', padding: '8px' });
    });
    it('adjusts insertion indices when moving down and up in the same column', () => {
        const design = createDefaultEmailDesignV2();
        const column = design.document.sections[0].columns[0];
        column.blocks = ['a', 'b', 'c'].map(id => ({ id, type: 'text', props: { html: `<p>${id}</p>` } }));
        const sectionId = design.document.sections[0].id;
        expect(relocateEmailBlock(design, 'a', sectionId, column.id, 3)).toBe(true);
        expect(column.blocks.map(block => block.id)).toEqual(['b', 'c', 'a']);
        expect(relocateEmailBlock(design, 'a', sectionId, column.id, 0)).toBe(true);
        expect(column.blocks.map(block => block.id)).toEqual(['a', 'b', 'c']);
        expect(relocateEmailBlock(design, 'a', sectionId, column.id, 1)).toBe(false);
    });
    it('moves footer layers across sections without losing identity or content', () => {
        const design = createDefaultEmailDesignV2();
        const source = design.document.sections[0].columns[0];
        const footer = { id: 'footer', type: 'footer' as const, props: { html: '<a href="{{unsubscribe_url}}">Unsubscribe</a>' } };
        source.blocks = [footer];
        const target = design.document.sections[1];
        target.columns[0].blocks = [];
        expect(moveEmailBlock(design, footer.id, 1)).toBe(true);
        expect(source.blocks).toEqual([]);
        expect(target.columns[0].blocks).toEqual([footer]);
    });
    it('does not remove content for invalid or stale drop targets', () => {
        const design = createDefaultEmailDesignV2();
        const section = design.document.sections[0];
        const column = section.columns[0];
        const blockId = column.blocks[0].id;
        const before = JSON.stringify(design);
        expect(relocateEmailBlock(design, blockId, 'missing', column.id, 0)).toBe(false);
        expect(relocateEmailBlock(design, blockId, section.id, 'missing', 0)).toBe(false);
        expect(relocateEmailBlock(design, blockId, section.id, column.id, 10000)).toBe(false);
        expect(relocateEmailBlock(design, 'missing', section.id, column.id, 0)).toBe(false);
        expect(JSON.stringify(design)).toBe(before);
    });
    it('reorders entire sections, preserving their nested content and handling no-op drops', () => {
        const design = createDefaultEmailDesignV2();
        const original = [...design.document.sections];
        expect(reorderEmailSection(design, original[0].id, original.length)).toBe(true);
        expect(design.document.sections).toEqual([...original.slice(1), original[0]]);
        expect(reorderEmailSection(design, original[0].id, 0)).toBe(true);
        expect(design.document.sections).toEqual(original);
        expect(reorderEmailSection(design, original[0].id, 1)).toBe(false);
        expect(reorderEmailSection(design, 'missing', 0)).toBe(false);
        expect(reorderEmailSection(design, original[0].id, -1)).toBe(false);
        expect(design.document.sections).toEqual(original);
    });
});
