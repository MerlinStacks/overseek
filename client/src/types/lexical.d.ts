/**
 * Type declarations for Lexical editor modules.
 * Provides ambient module declarations to suppress TypeScript errors.
 */

declare module 'lexical' {
    export class EditorState {
        read<T>(callback: () => T): T;
    }
    export class LexicalEditor {
        update(callback: () => void): void;
        registerCommand<T>(command: any, listener: (payload: T) => boolean, priority: number): () => void;
        registerUpdateListener(listener: (payload: { editorState: EditorState }) => void): () => void;
        dispatchCommand<T>(command: any, payload?: T): boolean;
        getElementByKey(key: string): HTMLElement | null;
    }
    export interface EditorThemeClasses {
        text?: {
            bold?: string;
            italic?: string;
            underline?: string;
            strikethrough?: string;
            code?: string;
            [key: string]: string | undefined;
        };
        list?: {
            nested?: { listitem?: string };
            ol?: string;
            ul?: string;
            listitem?: string;
            listitemChecked?: string;
            listitemUnchecked?: string;
            [key: string]: any;
        };
        heading?: {
            h1?: string;
            h2?: string;
            h3?: string;
            h4?: string;
            h5?: string;
            h6?: string;
            [key: string]: string | undefined;
        };
        [key: string]: any;
    }
    export function $getRoot(): any;
    export function $createTextNode(text: string): any;
    export function $createParagraphNode(): any;
    export function $getSelection(): any;
    export function $isRangeSelection(selection: any): boolean;
    export function $insertNodes(nodes: any[]): void;
    export function createEditor(config?: any): LexicalEditor;
    export const COMMAND_PRIORITY_NORMAL: number;
    export const COMMAND_PRIORITY_LOW: number;
    export const COMMAND_PRIORITY_HIGH: number;
    export const COMMAND_PRIORITY_CRITICAL: number;
    export const KEY_ENTER_COMMAND: any;
    export const FORMAT_TEXT_COMMAND: any;
    export const SELECTION_CHANGE_COMMAND: any;
}

declare module '@lexical/react/LexicalComposer' {
    import { ReactNode } from 'react';
    export interface InitialConfigType {
        namespace: string;
        theme?: any;
        nodes?: any[];
        onError?: (error: Error) => void;
    }
    export function LexicalComposer(props: { initialConfig: InitialConfigType; children: ReactNode }): JSX.Element;
}

declare module '@lexical/react/LexicalComposerContext' {
    import { LexicalEditor } from 'lexical';
    export function useLexicalComposerContext(): [LexicalEditor];
}

declare module '@lexical/react/LexicalRichTextPlugin' {
    import { ReactNode } from 'react';
    export function RichTextPlugin(props: { contentEditable: ReactNode; placeholder: ReactNode; ErrorBoundary: any }): JSX.Element;
}

declare module '@lexical/react/LexicalContentEditable' {
    export function ContentEditable(props: { className?: string; ariaLabel?: string }): JSX.Element;
}

declare module '@lexical/react/LexicalHistoryPlugin' {
    export function HistoryPlugin(): JSX.Element;
}

declare module '@lexical/react/LexicalErrorBoundary' {
    import { ComponentType } from 'react';
    const LexicalErrorBoundary: ComponentType<any>;
    export { LexicalErrorBoundary };
    export default LexicalErrorBoundary;
}

declare module '@lexical/react/LexicalLinkPlugin' {
    export function LinkPlugin(): JSX.Element;
}

declare module '@lexical/react/LexicalListPlugin' {
    export function ListPlugin(): JSX.Element;
}

declare module '@lexical/html' {
    import { LexicalEditor, EditorState } from 'lexical';
    export function $generateHtmlFromNodes(editor: LexicalEditor, selection?: any): string;
    export function $generateNodesFromDOM(editor: LexicalEditor, dom: Document): any[];
}

declare module '@lexical/link' {
    export class LinkNode { }
    export class AutoLinkNode { }
    export function $createLinkNode(url: string): any;
    export function $isLinkNode(node: any): boolean;
    export const TOGGLE_LINK_COMMAND: any;
}

declare module '@lexical/list' {
    export class ListNode {
        getListType(): string;
    }
    export class ListItemNode { }
    export function $isListNode(node: any): boolean;
    export const INSERT_ORDERED_LIST_COMMAND: any;
    export const INSERT_UNORDERED_LIST_COMMAND: any;
}

declare module '@lexical/rich-text' {
    export class HeadingNode { }
    export class QuoteNode { }
}

declare module '@lexical/utils' {
    export function $findMatchingParent(node: any, predicate: (node: any) => boolean): any;
    export function $getNearestNodeOfType<T>(node: any, nodeType: any): T | null;
    export function mergeRegister(...funcs: Array<() => void>): () => void;
}

declare module '@lexical/selection' {
    export function $setBlocksType(selection: any, factory: () => any): void;
}
