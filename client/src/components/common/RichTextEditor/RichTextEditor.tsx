/**
 * RichTextEditor - Unified rich text editor component built on Lexical.
 * Supports multiple variants and configurable features.
 */
import { useCallback, useMemo } from 'react';
import { Logger } from '../../../utils/logger';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkNode, AutoLinkNode } from '@lexical/link';
import { ListNode, ListItemNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';

import { editorTheme } from './themes/editorTheme';
import { ToolbarPlugin, type ToolbarFeature } from './plugins/ToolbarPlugin';
import { OnChangePlugin } from './plugins/OnChangePlugin';
import { InitialValuePlugin } from './plugins/InitialValuePlugin';
import { EnterSubmitPlugin } from './plugins/EnterSubmitPlugin';

import './RichTextEditor.css';

export type RichTextEditorVariant = 'compact' | 'standard' | 'full';

export interface RichTextEditorProps {
    /** Current HTML value */
    value: string;
    /** Called when content changes (HTML string) */
    onChange: (value: string) => void;
    /** Called when Enter is pressed (for compact variant, message sending) */
    onSubmit?: () => void;
    /** Placeholder text */
    placeholder?: string;
    /** Editor variant: compact (inbox), standard (forms), full (page) */
    variant?: RichTextEditorVariant;
    /** Enabled features */
    features?: ToolbarFeature[];
    /** Whether in internal/private note mode (for inbox styling) */
    isInternal?: boolean;
    /** Disable Enter submit (e.g., when canned response picker is open) */
    disableEnterSubmit?: boolean;
    /** Additional CSS class */
    className?: string;
}

// Default features per variant
const DEFAULT_FEATURES: Record<RichTextEditorVariant, ToolbarFeature[]> = {
    compact: ['bold', 'italic', 'link', 'emoji'],
    standard: ['bold', 'italic', 'underline', 'link', 'list'],
    full: ['bold', 'italic', 'underline', 'link', 'list', 'heading'],
};

function Placeholder({ text, variant }: { text: string; variant: RichTextEditorVariant }) {
    return (
        <div className={`rte-placeholder ${variant === 'compact' ? 'compact' : ''}`}>
            {text}
        </div>
    );
}

export function RichTextEditor({
    value,
    onChange,
    onSubmit,
    placeholder = 'Start typing...',
    variant = 'standard',
    features,
    isInternal = false,
    disableEnterSubmit = false,
    className = '',
}: RichTextEditorProps) {
    // Memoize features to prevent re-renders
    const enabledFeatures = useMemo(
        () => features || DEFAULT_FEATURES[variant],
        [features, variant]
    );

    // Error handler
    const onError = useCallback((error: Error) => {
        Logger.error('RichTextEditor error:', { error: error });
    }, []);

    // Initial config with nodes based on features
    const initialConfig = useMemo(() => ({
        namespace: 'RichTextEditor',
        theme: editorTheme,
        onError,
        nodes: [
            LinkNode,
            AutoLinkNode,
            ListNode,
            ListItemNode,
            HeadingNode,
            QuoteNode,
        ],
    }), [onError]);

    // Memoize onChange to prevent unnecessary re-renders
    const handleChange = useCallback((html: string) => {
        onChange(html);
    }, [onChange]);

    const variantClass = `variant-${variant}`;
    const internalClass = isInternal ? 'internal-mode' : '';

    return (
        <div className={`rich-text-editor ${variantClass} ${internalClass} ${className}`.trim()}>
            <LexicalComposer initialConfig={initialConfig}>
                {/* Toolbar - position depends on variant */}
                {variant !== 'compact' && (
                    <ToolbarPlugin features={enabledFeatures} />
                )}

                <div className="rte-editor-container">
                    <RichTextPlugin
                        contentEditable={<ContentEditable className="rich-text-editor-root" />}
                        placeholder={<Placeholder text={placeholder} variant={variant} />}
                        ErrorBoundary={LexicalErrorBoundary}
                    />
                </div>

                {/* Toolbar at bottom for compact variant */}
                {variant === 'compact' && (
                    <ToolbarPlugin features={enabledFeatures} />
                )}

                {/* Plugins */}
                <HistoryPlugin />
                <LinkPlugin />
                <ListPlugin />
                <OnChangePlugin onChange={handleChange} />
                <InitialValuePlugin initialValue={value} />

                {/* Enter submit for compact variant */}
                {variant === 'compact' && onSubmit && (
                    <EnterSubmitPlugin onSubmit={onSubmit} disabled={disableEnterSubmit} />
                )}
            </LexicalComposer>
        </div>
    );
}
