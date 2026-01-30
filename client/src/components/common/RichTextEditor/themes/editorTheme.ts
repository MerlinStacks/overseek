import type { EditorThemeClasses } from 'lexical';

/**
 * Theme configuration for Lexical editor.
 * Maps Lexical node types to CSS classes.
 */
export const editorTheme: EditorThemeClasses = {
    // Root container
    root: 'rich-text-editor-root',

    // Text formatting
    text: {
        bold: 'rte-bold',
        italic: 'rte-italic',
        underline: 'rte-underline',
        strikethrough: 'rte-strikethrough',
        code: 'rte-code',
    },

    // Links
    link: 'rte-link',

    // Lists
    list: {
        nested: {
            listitem: 'rte-nested-list-item',
        },
        ol: 'rte-ol',
        ul: 'rte-ul',
        listitem: 'rte-list-item',
        listitemChecked: 'rte-list-item-checked',
        listitemUnchecked: 'rte-list-item-unchecked',
    },

    // Headings
    heading: {
        h1: 'rte-h1',
        h2: 'rte-h2',
        h3: 'rte-h3',
        h4: 'rte-h4',
        h5: 'rte-h5',
        h6: 'rte-h6',
    },

    // Paragraphs
    paragraph: 'rte-paragraph',

    // Placeholder
    placeholder: 'rte-placeholder',

    // Images
    image: 'rte-image',
};
