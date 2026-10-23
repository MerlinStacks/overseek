import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { compileEmailDesignV2, createDefaultEmailDesignV2, getEmailBlockAlignment, getEmailBlockPadding, normalizeEmailTextHtml, type EmailBlock } from '../../../lib/emailDesignerV2';
import { createBlock } from './blockFactory';
import { LiveBlock } from './LiveBlock';

const theme = createDefaultEmailDesignV2().document.theme;
function compiledBlock(block: EmailBlock): HTMLElement {
    const design = createDefaultEmailDesignV2();
    design.document.sections = [{ id: 'section', padding: '0', columns: [{ id: 'column', width: 100, blocks: [block] }] }];
    const doc = new DOMParser().parseFromString(compileEmailDesignV2(design), 'text/html');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = doc.querySelector('.os-email-section > table > tbody > tr > td')!.innerHTML;
    return wrapper.firstElementChild as HTMLElement;
}

describe('email block layout parity', () => {
    it.each<EmailBlock['type']>(['text', 'image', 'siteLogo', 'button', 'list', 'divider', 'spacer', 'product', 'newProducts', 'cartItems', 'cartLink', 'orderSummary', 'orderTracking', 'address', 'coupon', 'review', 'menu', 'social', 'footer', 'rawHtml'])('%s uses inspector defaults on both rendering surfaces and respects zero padding', async type => {
        const block = createBlock(type);
        const { container, rerender } = render(<LiveBlock block={block} theme={theme} onUpdate={vi.fn()} />);
        await act(async () => {});
        const expected = document.createElement('div');
        expected.style.padding = getEmailBlockPadding(block);
        const padding = expected.style.padding;
        const delivery = compiledBlock(block);
        expect(delivery.style.padding).toBe(padding);
        expect(delivery.style.textAlign).toBe(getEmailBlockAlignment(block));
        expect(Array.from(container.querySelectorAll<HTMLElement>('[style]')).some(element => element.style.padding === padding)).toBe(true);
        const compact = { ...block, props: { ...block.props, padding: '0' } } as EmailBlock;
        rerender(<LiveBlock block={compact} theme={theme} onUpdate={vi.fn()} />);
        expect(compiledBlock(compact).style.padding).toBe('0px');
        expect(Array.from(container.querySelectorAll<HTMLElement>('[style]')).some(element => element.style.padding === '0px')).toBe(true);
    });

    it.each(['left', 'center', 'right'] as const)('aligns images and logos %s in the editor and delivery HTML', align => {
        for (const type of ['image', 'siteLogo', 'product'] as const) {
            const block = createBlock(type);
            Object.assign(block.props, { align, src: 'https://shop.test/logo.png', productImage: 'https://shop.test/product.png', productName: 'Product' });
            const { container, unmount } = render(<LiveBlock block={block} theme={theme} onUpdate={vi.fn()} />);
            const image = container.querySelector('img')!;
            const deliveryImage = compiledBlock(block).querySelector('img')!;
            expect(image.style.margin).toBe(deliveryImage.style.margin);
            expect(image.style.marginLeft).toBe(align === 'left' ? '0px' : 'auto');
            expect(image.style.marginRight).toBe(align === 'right' ? '0px' : 'auto');
            unmount();
        }
    });

    it.each(['coupon', 'review'] as const)('does not add uncontrolled outer margins to %s', type => {
        const block = createBlock(type);
        const { container } = render(<LiveBlock block={block} theme={theme} onUpdate={vi.fn()} />);
        expect(container.firstElementChild).toHaveStyle({ margin: '0' });
        expect(compiledBlock(block).style.margin).toBe('0px');
    });

    it('opens imported text without rewriting it or multiplying the heading size', async () => {
        const update = vi.fn();
        const block: EmailBlock = { id: 'heading', type: 'text', props: { padding: '0', size: 34, html: '<h1 style="font-weight:500;line-height:42px;margin:0 0 16px">Your story is waiting.</h1>' } };
        render(<LiveBlock block={block} theme={theme} onUpdate={update} />);
        const editor = screen.getByRole('textbox', { name: 'Email text block' });
        await waitFor(() => expect(editor.querySelector('h1')?.style.fontSize).toBe('inherit'));
        expect(editor.querySelector('h1')).toHaveStyle({ fontWeight: '500', lineHeight: '42px', margin: '0 0 16px' });
        expect(update).not.toHaveBeenCalled();
        const heading = compiledBlock(block).querySelector('h1')!;
        expect(heading.style.fontSize).toBe('inherit');
        expect(heading).toHaveStyle({ fontWeight: '500', lineHeight: '42px', margin: '0 0 16px' });
    });

    it('uses idempotent text defaults and preserves explicitly sized headings and paragraph margins', () => {
        const html = '<h1 style="font-size:34px;font-weight:500">Heading</h1><p style="margin:0 0 16px">First</p><p>Last</p>';
        const normalized = normalizeEmailTextHtml(html, 15);
        expect(normalizeEmailTextHtml(normalized, 15)).toBe(normalized);
        const doc = document.createElement('div');
        doc.innerHTML = normalized;
        expect(doc.querySelector('h1')).toHaveStyle({ fontSize: '34px', fontWeight: '500' });
        expect(doc.querySelector('p')).toHaveStyle({ margin: '0 0 16px' });
        expect(doc.querySelector('p:last-child')).toHaveStyle({ margin: '0' });
    });
});
