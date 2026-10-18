import { describe, expect, it } from 'vitest';
import { importEmailHtml } from './importEmailHtml';
import { compileEmailDesignV2, createDefaultEmailDesignV2 } from './emailDesignerV2';

describe('HTML email import', () => {
    it('imports text, images and buttons as editable blocks with merge tags intact', () => {
        const design = importEmailHtml('<p>Hello {{customer.firstName}}</p><img src="https://shop.test/logo.png" alt="Logo"><a href="{{cart.recoveryUrl}}" style="background:#ffcc00;color:#000;padding:12px">Return to cart</a>');
        const blocks = design.document.sections[0].columns[0].blocks;
        expect(blocks.map(block => block.type)).toEqual(['text', 'image', 'button']);
        expect(compileEmailDesignV2(design)).toContain('{{customer.firstName}}');
        expect(compileEmailDesignV2(design)).toContain('{{cart.recoveryUrl}}');
    });

    it('imports table columns as editable designer columns', () => {
        const design = importEmailHtml('<table><tr><td>Left</td><td>Right {{cart.itemsTable}}</td></tr></table>');
        expect(design.document.sections[0].columns).toHaveLength(2);
        expect(design.document.sections[0].columns[0].blocks[0].type).toBe('text');
        expect(compileEmailDesignV2(design)).toContain('Right {{cart.itemsTable}}');
    });

    it('retains nested complex tables as HTML blocks', () => {
        const design = importEmailHtml('<div><p>Heading</p><table><tr><td>Left</td><td>Right</td></tr></table></div>');
        expect(design.document.sections[0].columns[0].blocks[1].type).toBe('rawHtml');
        expect(compileEmailDesignV2(design)).toContain('<td>Right</td>');
    });

    it('imports the sections and columns of modified visual-builder HTML', () => {
        const original = createDefaultEmailDesignV2();
        const html = compileEmailDesignV2(original).replace('Big news from', 'New content from');
        const imported = importEmailHtml(html);
        expect(imported.document.sections).toHaveLength(original.document.sections.length);
        expect(compileEmailDesignV2(imported)).toContain('New content from');
        expect(compileEmailDesignV2(imported)).not.toContain('Big news from');
    });

    it('strips executable markup', () => {
        const html = compileEmailDesignV2(importEmailHtml('<p onclick="alert(1)">Safe</p><script>alert(1)</script><img src="x" onerror="alert(2)">'));
        expect(html).not.toMatch(/onclick|onerror|alert\(/);
    });
});
