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
                if (!event || disabled) return false;

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
