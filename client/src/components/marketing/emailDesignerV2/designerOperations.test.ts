import { describe, expect, it } from 'vitest';
import { createDefaultEmailDesignV2 } from '../../../lib/emailDesignerV2';
import { copyEmailBlockStyles, moveEmailBlock } from './designerOperations';
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
});
