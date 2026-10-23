import { describe, expect, it } from 'vitest';
import { compileEmailDesignV2, createDefaultEmailDesignV2 } from '../../../lib/emailDesignerV2';
import { createBlock, createPaletteBlock, paletteItems } from './blockFactory';

describe('responsive builder defaults', () => {
    it.each(paletteItems)('enables responsiveness for $label palette content', ({ key }) => {
        expect(createPaletteBlock(key, 'Store').responsive).toBe(true);
    });

    it('enables responsiveness on blocks created outside the palette', () => {
        expect(createBlock('text').responsive).toBe(true);
        expect(createBlock('cartItems').responsive).toBe(true);
        expect(createBlock('rawHtml').responsive).toBe(true);
    });

    it('renders unset responsiveness as enabled and respects an explicit opt-out', () => {
        const design = createDefaultEmailDesignV2();
        const block = createBlock('text');
        delete block.responsive;
        design.document.sections = [{ id: 'section', columns: [{ id: 'column', width: 100, blocks: [block] }] }];
        const doc = new DOMParser().parseFromString(compileEmailDesignV2(design), 'text/html');
        expect(doc.querySelector('.os-email-text')?.classList.contains('os-responsive-block')).toBe(true);
        block.responsive = false;
        const fixed = new DOMParser().parseFromString(compileEmailDesignV2(design), 'text/html');
        expect(fixed.querySelector('.os-email-text')?.classList.contains('os-responsive-block')).toBe(false);
    });
});
