import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode } from '@lexical/rich-text';
import { $getRoot, $isElementNode, $isTextNode, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { sanitizeEmailHtml } from '../../../utils/emailHtml';
import { emailTextHtmlConfig } from './emailTextHtmlConfig';

describe('email rich-text HTML round trips', () => {
    it('keeps imported block and inline styles after changing text, and through undo serialization', () => {
        const editor = createEditor({ namespace: 'email-test', nodes: [HeadingNode, LinkNode, ListNode, ListItemNode], html: emailTextHtmlConfig, onError: error => { throw error; } });
        editor.update(() => {
            const dom = new DOMParser().parseFromString(sanitizeEmailHtml('<h1 style="font-size:34px;font-weight:500;line-height:42px;margin:0 0 16px">Heading</h1><p style="font-size:15px;color:#666666;line-height:25px;margin:0 0 16px">Hello <span style="color:#c4006b;font-size:18px"><strong>friend</strong></span> <a href="{{cart.recoveryUrl}}" style="color:#c4006b;text-decoration:underline">Return</a></p>'), 'text/html');
            $getRoot().append(...$generateNodesFromDOM(editor, dom));
        }, { discrete: true });
        editor.update(() => {
            const first = $getRoot().getFirstDescendant();
            if ($isTextNode(first)) first.setTextContent('Edited heading');
        }, { discrete: true });
        // Styles must live in serializable node state, not only the DOM.
        const snapshot = editor.getEditorState().toJSON();
        editor.setEditorState(editor.parseEditorState(snapshot));
        editor.getEditorState().read(() => {
            const html = sanitizeEmailHtml($generateHtmlFromNodes(editor));
            const doc = document.createElement('div');
            doc.innerHTML = html;
            expect(doc.querySelector('h1')).toHaveTextContent('Edited heading');
            expect(doc.querySelector('h1')).toHaveStyle({ fontSize: '34px', fontWeight: '500', lineHeight: '42px', margin: '0 0 16px' });
            expect(doc.querySelector('p')).toHaveStyle({ fontSize: '15px', lineHeight: '25px', color: '#666666', margin: '0 0 16px' });
            expect(doc.querySelector('a')).toHaveAttribute('href', '{{cart.recoveryUrl}}');
            expect(doc.querySelector('a')).toHaveStyle({ color: '#c4006b', textDecoration: 'underline' });
            const styled = Array.from(doc.querySelectorAll<HTMLElement>('[style]')).find(element => element.textContent === 'friend' && element.style.fontSize === '18px');
            expect(styled).toHaveStyle({ color: '#c4006b' });
        });
    });

    it('lets alignment edits override imported text alignment', () => {
        const editor = createEditor({ namespace: 'alignment', html: emailTextHtmlConfig, onError: error => { throw error; } });
        editor.update(() => {
            const dom = new DOMParser().parseFromString('<p style="text-align:left;color:#123456">Text</p>', 'text/html');
            $getRoot().append(...$generateNodesFromDOM(editor, dom));
            const paragraph = $getRoot().getFirstChild();
            if ($isElementNode(paragraph)) paragraph.setFormat('right');
        }, { discrete: true });
        editor.getEditorState().read(() => {
            const doc = document.createElement('div');
            doc.innerHTML = $generateHtmlFromNodes(editor);
            expect(doc.querySelector('p')).toHaveStyle({ textAlign: 'right', color: '#123456' });
        });
    });
});
