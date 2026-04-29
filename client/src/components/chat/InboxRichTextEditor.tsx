/**
 * Rich text editor for the inbox composer.
 * Thin wrapper around the unified RichTextEditor component.
 */
import { RichTextEditor } from '../common/RichTextEditor';
import type { ReactNode } from 'react';

interface InboxRichTextEditorProps {
    /** Current HTML value */
    value: string;
    /** Called when content changes */
    onChange: (value: string) => void;
    /** Called when Enter is pressed (without Shift) */
    onSubmit?: () => void;
    /** Placeholder text */
    placeholder?: string;
    /** Whether the editor is in internal/private note mode */
    isInternal?: boolean;
    /** Whether canned response picker is open (disables Enter submit) */
    cannedPickerOpen?: boolean;
    /** Extra controls to render in the same toolbar row */
    toolbarRightSlot?: ReactNode;
}

/**
 * InboxRichTextEditor - A compact rich text editor for message composition.
 * Features: Bold, Italic, Link, Emoji picker
 */
export function InboxRichTextEditor({
    value,
    onChange,
    onSubmit,
    placeholder = 'Type your reply...',
    isInternal = false,
    cannedPickerOpen = false,
    toolbarRightSlot
}: InboxRichTextEditorProps) {
    return (
        <RichTextEditor
            variant="compact"
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            placeholder={placeholder}
            features={['bold', 'italic', 'link', 'emoji']}
            isInternal={isInternal}
            disableEnterSubmit={cannedPickerOpen}
            toolbarRightSlot={toolbarRightSlot}
        />
    );
}
