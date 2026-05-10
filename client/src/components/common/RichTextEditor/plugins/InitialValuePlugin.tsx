/**
 * InitialValuePlugin - Syncs external HTML value to Lexical state.
 * Handles initial load, canned response insertion, and clearing after send.
 * 
 * Uses a flag to track whether updates are internal (from the editor itself)
 * or external (from props like canned response selection or clearing).
 */
import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $getRoot, $insertNodes, $createParagraphNode } from 'lexical';

interface InitialValuePluginProps {
    initialValue: string;
}

/**
 * Normalizes HTML for comparison by stripping whitespace and empty tags.
 */
function normalizeHtml(html: string): string {
    return html
        .replace(/<p><br><\/p>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Preprocesses plain text content to preserve line breaks and whitespace
 * before HTML parsing. If content contains HTML tags, returns as-is.
 */
function preprocessValue(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return value;

    // If content already contains HTML tags, treat as HTML and return as-is
    if (/<[a-z][\s\S]*>/i.test(trimmed)) {
        return value;
    }

    // Plain text: escape HTML entities and convert whitespace to preserve formatting
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
        .replace(/\r\n/g, '<br>')
        .replace(/\n/g, '<br>');
}

export function InitialValuePlugin({ initialValue }: InitialValuePluginProps) {
    const [editor] = useLexicalComposerContext();
    const lastExternalValueRef = useRef<string>('');
    const currentEditorValueRef = useRef<string>('');

    useEffect(() => {
        return editor.registerUpdateListener(({ editorState }) => {
            editorState.read(() => {
                currentEditorValueRef.current = normalizeHtml($generateHtmlFromNodes(editor, null));
            });
        });
    }, [editor]);

    useEffect(() => {
        // Normalize for comparison
        const normalizedExternal = normalizeHtml(initialValue || '');
        const normalizedLastExternal = normalizeHtml(lastExternalValueRef.current || '');
        if (normalizedExternal === normalizedLastExternal) {
            return;
        }

        // If the editor already contains this content, the update came from
        // the editor itself and we should preserve the current selection.
        if (normalizedExternal === currentEditorValueRef.current) {
            lastExternalValueRef.current = initialValue || '';
            return;
        }

        // Update the editor with the new external value
        lastExternalValueRef.current = initialValue || '';

        editor.update(() => {
            const root = $getRoot();

            // Handle empty value (clearing the editor)
            if (!initialValue || initialValue.trim() === '') {
                root.clear();
                const paragraph = $createParagraphNode();
                root.append(paragraph);
                return;
            }

            // Parse and insert HTML content (preprocess to preserve plain-text formatting)
            const parser = new DOMParser();
            const processedValue = preprocessValue(initialValue);
            const dom = parser.parseFromString(processedValue, 'text/html');
            const nodes = $generateNodesFromDOM(editor, dom);

            root.clear();
            $insertNodes(nodes);
        });

        currentEditorValueRef.current = normalizedExternal;
    }, [editor, initialValue]);

    return null;
}
