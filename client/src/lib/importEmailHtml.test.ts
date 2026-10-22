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

    it('imports table rows alongside other content as editable sections', () => {
        const design = importEmailHtml('<div><p>Heading</p><table><tr><td>Left</td><td>Right</td></tr></table></div>');
        expect(design.document.sections[0].name).toBe('Heading');
        expect(design.document.sections[1].columns).toHaveLength(2);
        expect(design.document.sections[1].columns[1].blocks[0]).toMatchObject({ type: 'text', props: { html: 'Right' } });
    });

    it('splits wrapped content into the existing text, image, list, button and divider blocks', () => {
        const design = importEmailHtml(`<div style="text-align:center;color:#123456;font-size:18px">
            <h1>Welcome {{customer.firstName}}</h1><p>First paragraph</p><p>Second paragraph</p>
            <a href="https://shop.test"><span><img src="https://shop.test/banner.png" alt="Banner"></span></a>
            <ul><li>One item</li><li>Two</li></ul>
            <div><a href="{{cart.recoveryUrl}}" style="background:#ffcc00;padding:12px"><span>Shop now</span></a></div><hr>
            <div style="height:24px">&nbsp;</div></div>`);
        const blocks = design.document.sections[0].columns[0].blocks;
        expect(blocks.map(block => block.type)).toEqual(['text', 'text', 'text', 'image', 'list', 'button', 'divider', 'spacer']);
        expect(blocks[0]).toMatchObject({ props: { align: 'center', color: 'rgb(18, 52, 86)', size: 18 } });
        expect(blocks[3]).toMatchObject({ props: { href: 'https://shop.test', alt: 'Banner' } });
        expect(blocks[4]).toMatchObject({ props: { items: ['One item', 'Two'], ordered: false } });
        expect(blocks[5]).toMatchObject({ props: { label: 'Shop now', href: '{{cart.recoveryUrl}}' } });
        expect(blocks[7]).toMatchObject({ props: { height: 24 } });
    });

    it('unwraps email table shells and recognises table-cell buttons', () => {
        const design = importEmailHtml(`<div><table width="600"><tr><td><div><table role="presentation"><tr>
            <td width="40%"><img src="https://shop.test/product.png"></td>
            <td width="60%"><h2>Product</h2><p>Description</p><table role="presentation"><tr><td style="background-color:#ffcc00;border-radius:8px"><a href="{{cart.recoveryUrl}}">Buy now</a></td></tr></table></td>
            </tr></table></div></td></tr></table></div>`);
        expect(design.document.theme.contentWidth).toBe(600);
        const columns = design.document.sections[0].columns;
        expect(columns.map(column => column.width)).toEqual([40, 60]);
        expect(columns[0].blocks[0].type).toBe('image');
        expect(columns[1].blocks.map(block => block.type)).toEqual(['text', 'text', 'button']);
        expect(columns[1].blocks[2]).toMatchObject({ props: { label: 'Buy now', backgroundColor: 'rgb(255, 204, 0)', borderRadius: 8 } });
    });

    it('preserves data tables and unsupported spans as HTML', () => {
        for (const html of ['<table><tr><th>Name</th><th>Price</th></tr><tr><td>Item</td><td>$10</td></tr></table>', '<table><tr><td colspan="2">Spanning content</td></tr><tr><td>Left</td><td>Right</td></tr></table>']) {
            const blocks = importEmailHtml(html).document.sections[0].columns[0].blocks;
            expect(blocks[0]).toMatchObject({ type: 'rawHtml', props: { html: new DOMParser().parseFromString(html, 'text/html').body.innerHTML } });
        }
    });

    it('keeps rich list formatting without rendering HTML tags as list text', () => {
        const design = importEmailHtml('<ul><li>One <strong>item</strong></li></ul>');
        expect(design.document.sections[0].columns[0].blocks[0].type).toBe('text');
        expect(compileEmailDesignV2(design)).toContain('<strong>item</strong>');
    });

    it('does not import hidden content', () => {
        const html = compileEmailDesignV2(importEmailHtml('<div style="display:none">Hidden preheader</div><div><h1>Visible</h1><p hidden>Hidden text</p></div>'));
        expect(html).toContain('Visible');
        expect(html).not.toContain('Hidden');
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
