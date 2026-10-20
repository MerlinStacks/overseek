/**
 * EnterSubmitPlugin - Handles Enter key to trigger submit (for inbox composer).
 * Press Enter to submit, Shift+Enter for new line.
 */
import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH } from 'lexical';

interface EnterSubmitPluginProps {
    onSubmit?: () => void;
    disabled?: boolean;
}

export function EnterSubmitPlugin({ onSubmit, disabled }: EnterSubmitPluginProps) {
    const [editor] = useLexicalComposerContext();

    useEffect(() => {
        if (!onSubmit) return;

        return editor.registerCommand(
            KEY_ENTER_COMMAND,
            (event: KeyboardEvent | null) => {
                if (!event || disabled || event.defaultPrevented || !editor.isEditable()) return false;
                // IME confirmation is not a request to send (229 covers legacy Safari IME events).
                if (event.isComposing || editor.isComposing() || event.keyCode === 229) return false;
                const root = editor.getRootElement();
                if (!root || !(event.target instanceof Node) || !root.contains(event.target)) return false;

                // Shift+Enter creates new line (default behavior)
                if (event.shiftKey) return false;

                // Enter without Shift triggers submit
                event.preventDefault();
                onSubmit();
                return true;
            },
            COMMAND_PRIORITY_HIGH
        );
    }, [editor, onSubmit, disabled]);

    return null;
}
