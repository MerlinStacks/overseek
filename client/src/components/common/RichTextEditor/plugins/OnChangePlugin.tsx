/**
 * OnChangePlugin - Converts Lexical EditorState to HTML and calls parent onChange.
 */
import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $generateHtmlFromNodes } from '@lexical/html';

interface OnChangePluginProps {
    onChange: (html: string) => void;
}

export function OnChangePlugin({ onChange }: OnChangePluginProps) {
    const [editor] = useLexicalComposerContext();

    useEffect(() => {
        return editor.registerUpdateListener(({ editorState }) => {
            editorState.read(() => {
                const html = $generateHtmlFromNodes(editor, null);
                // Lexical wraps empty content in <p><br></p>, normalize to empty string
                const normalizedHtml = html === '<p><br></p>' ? '' : html;
                onChange(normalizedHtml);
            });
        });
    }, [editor, onChange]);

    return null;
}
