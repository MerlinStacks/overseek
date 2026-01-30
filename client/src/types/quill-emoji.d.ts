/**
 * Type declarations for quill-emoji module.
 * The package doesn't ship with TypeScript definitions.
 */
declare module 'quill-emoji' {
    import Quill from 'quill';

    interface EmojiModule {
        new(quill: Quill, options?: unknown): unknown;
    }

    export const EmojiBlot: unknown;
    export const ShortNameEmoji: EmojiModule;
    export const ToolbarEmoji: EmojiModule;
    export const TextAreaEmoji: EmojiModule;
}
