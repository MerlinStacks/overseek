/**
 * OnChangePlugin - Converts Lexical EditorState to HTML and calls parent onChange.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $generateHtmlFromNodes } from '@lexical/html';

interface OnChangePluginProps {
    onChange: (html: string) => void;
    externalUpdateRef: RefObject<boolean>;
}

export function OnChangePlugin({ onChange, externalUpdateRef }: OnChangePluginProps) {
    const [editor] = useLexicalComposerContext();

    useEffect(() => {
        return editor.registerUpdateListener(({ editorState }) => {
            if (externalUpdateRef.current) {
                externalUpdateRef.current = false;
                return;
            }

            editorState.read(() => {
                const html = $generateHtmlFromNodes(editor, null);
                // Lexical wraps empty content in <p><br></p>, normalize to empty string
                const normalizedHtml = html === '<p><br></p>' ? '' : html;
                onChange(normalizedHtml);
            });
        });
    }, [editor, externalUpdateRef, onChange]);

    return null;
}
