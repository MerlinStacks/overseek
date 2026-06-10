import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $createLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListItemNode, ListNode } from '@lexical/list';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { $createHeadingNode, HeadingNode } from '@lexical/rich-text';
import { $patchStyleText, $setBlocksType } from '@lexical/selection';
import {
    $createParagraphNode,
    $createTextNode,
    $getRoot,
    $getSelection,
    $insertNodes,
    $isRangeSelection,
    COMMAND_PRIORITY_LOW,
    FORMAT_TEXT_COMMAND,
    PASTE_COMMAND,
    SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { AlignCenter, AlignLeft, AlignRight, Bold, Copy, Italic, Link2, List, ListOrdered, Search, Strikethrough, Underline, X } from 'lucide-react';
import { getSocialIconSvg, getSocialPlatform, getSocialPlatformColor } from '../../../lib/emailDesignerV2';
import type { EmailBlock, EmailDesignTheme, SocialIconStyle } from '../../../lib/emailDesignerV2';
import { EMAIL_MERGE_TAGS, type MergeTagDefinition } from './mergeTags';
import { LTR_TEXT_STYLE, sanitizeBidiText } from '../textInputBidi';
import { sanitizeEmailHtml, sanitizeEmailPaste, stripBidiControls } from '../../../utils/emailHtml';

const MERGE_TAG_CATEGORIES: Array<{ id: MergeTagDefinition['category']; label: string }> = [
    { id: 'customer', label: 'Customer' },
    { id: 'order', label: 'Order' },
    { id: 'product', label: 'Product' },
    { id: 'coupon', label: 'Coupon' },
    { id: 'review', label: 'Review' },
    { id: 'cart', label: 'Cart' },
    { id: 'general', label: 'General' },
];

const EMAIL_TEXT_EDITOR_CONTENT_CLASS = 'os-email-text-editor-content';
const EMAIL_TEXT_EDITOR_CONTENT_STYLE = `
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} h1,
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} h2,
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} h3,
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} p,
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} ul,
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} ol {
    margin: 0 0 0.8em;
}
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} > :last-child {
    margin-bottom: 0;
}
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} h1 {
    font-size: 2em;
    font-weight: 700;
    line-height: 1.25;
}
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} h2 {
    font-size: 1.5em;
    font-weight: 700;
    line-height: 1.3;
}
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} h3 {
    font-size: 1.17em;
    font-weight: 700;
    line-height: 1.35;
}
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} ul,
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} ol {
    padding-left: 1.4em;
}
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} ul {
    list-style: disc;
}
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} ol {
    list-style: decimal;
}
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} strong,
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} b {
    font-weight: 700;
}
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} em,
.${EMAIL_TEXT_EDITOR_CONTENT_CLASS} i {
    font-style: italic;
}
`;

export function LiveBlock({ block, theme, onUpdate }: { block: EmailBlock; theme: EmailDesignTheme; onUpdate: (updater: (block: EmailBlock) => void) => void }) {
    const responsiveStyle: CSSProperties = block.responsive ? { width: '100%', maxWidth: '100%' } : {};
    if (block.type === 'siteLogo') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center', ...responsiveStyle }}>{block.props.src ? <img src={block.props.src} alt={block.props.alt || block.props.fallbackText || 'Logo'} width={block.props.width || 160} style={{ display: 'block', maxWidth: '100%', height: 'auto', border: 0, margin: '0 auto' }} /> : <h1 style={{ margin: 0, color: theme.textColor, fontSize: 28, lineHeight: 1.25 }}>{block.props.fallbackText || block.props.alt || 'Your Store'}</h1>}</div>;
    }
    if (block.type === 'text') {
        return <EditableTextBlock block={block} theme={theme} onUpdate={onUpdate} />;
    }
    if (block.type === 'button') {
        return <EditableButtonBlock block={block} theme={theme} onUpdate={onUpdate} />;
    }
    if (block.type === 'list') {
        const Tag = block.props.ordered ? 'ol' : 'ul';
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: (block.props as { align?: 'left' | 'center' | 'right' }).align || 'left', color: block.props.color || theme.textColor, ...responsiveStyle }}><Tag style={{ margin: 0, paddingLeft: 22, lineHeight: 1.6 }}>{block.props.items.map((item, index) => <li key={index} contentEditable suppressContentEditableWarning dir="ltr" onFocus={(event) => normalizeEditorDirection(event.currentTarget)} onBlur={(event) => {
            normalizeEditorDirection(event.currentTarget);
            const nextItem = sanitizeRtlText(event.currentTarget.textContent || '');
            onUpdate((draft) => {
                if (draft.type === 'list') draft.props.items[index] = nextItem;
            });
        }} style={{ margin: '0 0 6px', outline: 'none', direction: 'ltr', unicodeBidi: 'isolate', writingMode: 'horizontal-tb' }}>{item}</li>)}</Tag></div>;
    }
    if (block.type === 'image') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center', ...responsiveStyle }}><img src={block.props.src} alt={block.props.alt || ''} width={block.props.width || 560} style={{ display: 'block', maxWidth: '100%', height: 'auto', border: 0, margin: '0 auto' }} /></div>;
    }
    if (block.type === 'coupon') {
        return <div style={{ padding: (block.props as { padding?: string }).padding || '18px', margin: '8px 0', background: '#eef2ff', border: `1px dashed ${theme.primaryColor}`, borderRadius: theme.borderRadius, textAlign: (block.props as { align?: 'left' | 'center' | 'right' }).align || 'center', ...responsiveStyle }}><p contentEditable suppressContentEditableWarning dir="ltr" onFocus={(event) => normalizeEditorDirection(event.currentTarget)} onBlur={(event) => {
            normalizeEditorDirection(event.currentTarget);
            const nextHeadline = sanitizeRtlText(event.currentTarget.textContent || '');
            onUpdate((draft) => {
                if (draft.type === 'coupon') draft.props.headline = nextHeadline;
            });
        }} style={{ margin: '0 0 6px', color: theme.textColor, fontSize: 18, fontWeight: 700, outline: 'none', direction: 'ltr', unicodeBidi: 'isolate', writingMode: 'horizontal-tb' }}>{block.props.headline}</p><p style={{ margin: '0 0 8px', color: theme.primaryColor, fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>{block.props.code || '{{coupon.code}}'}</p><p style={{ margin: 0, color: theme.mutedTextColor, lineHeight: 1.5 }}>{block.props.description || '{{coupon.description}}'}</p></div>;
    }
    if (block.type === 'review') {
        const ratingNumber = Math.min(5, Math.max(1, Number(block.props.rating || '5') || 5));
        const stars = '★'.repeat(ratingNumber);
        const showHeadline = block.props.showHeadline !== false;
        const showRating = block.props.showRating !== false;
        const showContent = block.props.showContent !== false;
        const showReviewer = block.props.showReviewer !== false;
        const showProductName = block.props.showProductName !== false;
        const showCta = block.props.showCta !== false;
        return <div style={{ padding: block.props.padding || '18px', margin: '8px 0', background: block.props.backgroundColor || 'transparent', border: block.props.borderColor ? `1px solid ${block.props.borderColor}` : 0, borderRadius: theme.borderRadius, textAlign: block.props.align || 'left', ...responsiveStyle }}>{showHeadline && <p contentEditable suppressContentEditableWarning dir="ltr" onFocus={(event) => normalizeEditorDirection(event.currentTarget)} onBlur={(event) => {
            normalizeEditorDirection(event.currentTarget);
            const nextHeadline = sanitizeRtlText(event.currentTarget.textContent || '');
            onUpdate((draft) => {
                if (draft.type === 'review') draft.props.headline = nextHeadline;
            });
        }} style={{ margin: '0 0 8px', color: theme.textColor, fontSize: 18, fontWeight: 700, outline: 'none', direction: 'ltr', unicodeBidi: 'isolate', writingMode: 'horizontal-tb' }}>{block.props.headline || 'Customer review'}</p>}{showRating && <p style={{ margin: '0 0 8px', color: '#b45309', fontSize: 18, letterSpacing: 1 }}>{stars}</p>}{showContent && <p style={{ margin: '0 0 10px', color: theme.textColor, lineHeight: 1.6 }}>{block.props.content || '{{review.content}}'}</p>}{(showReviewer || showProductName) && <p style={{ margin: '0 0 14px', color: theme.mutedTextColor, fontSize: 13 }}>- {showReviewer ? (block.props.reviewer || '{{review.reviewer}}') : ''}{showReviewer && showProductName ? ' ' : ''}{showProductName ? `on ${block.props.productName || '{{review.productName}}'}` : ''}</p>}{showCta && <a href={block.props.ctaHref || '{{review.productUrl}}'} style={{ display: 'inline-block', background: theme.primaryColor, color: '#ffffff', borderRadius: theme.borderRadius, padding: '10px 16px', fontWeight: 700, textDecoration: 'none' }}>{block.props.ctaLabel || 'Write your review'}</a>}</div>;
    }
    if (block.type === 'social') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center', fontSize: 14, lineHeight: 1.5 }}>{block.props.links.map((link, index) => {
            const iconStyle = link.iconStyle || block.props.iconStyle || 'solid';
            const iconSet = block.props.iconSet || 'native';
            const baseColor = block.props.color || theme.primaryColor;
            const iconColor = iconSet === 'native' ? getSocialPlatformColor(getSocialPlatform(link.label), baseColor) : baseColor;
            return <span key={`${link.label}-${index}`} style={getSocialPreviewStyle(iconStyle, iconColor)} title={link.label}><span dangerouslySetInnerHTML={{ __html: getSocialIconSvg(link.label, iconStyle, iconColor, iconSet) }} /></span>;
        })}</div>;
    }
    if (block.type === 'menu') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center', fontSize: 14, lineHeight: 1.5 }}>{block.props.links.map((link, index) => <span key={`${link.label}-${index}`} contentEditable suppressContentEditableWarning dir="ltr" onFocus={(event) => normalizeEditorDirection(event.currentTarget)} onBlur={(event) => {
            normalizeEditorDirection(event.currentTarget);
            const nextLabel = sanitizeRtlText(event.currentTarget.textContent || link.label);
            onUpdate((draft) => {
                if (draft.type === block.type) draft.props.links[index].label = nextLabel;
            });
        }} style={{ display: 'inline-block', margin: '0 10px', color: block.props.color || theme.primaryColor, fontWeight: 600, outline: 'none', direction: 'ltr', unicodeBidi: 'isolate', writingMode: 'horizontal-tb' }}>{link.label}</span>)}</div>;
    }
    if (block.type === 'footer') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center', fontSize: 12, lineHeight: 1.6, color: block.props.color || theme.mutedTextColor }} dangerouslySetInnerHTML={{ __html: block.props.html || '<p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>' }} />;
    }
    if (block.type === 'divider') return <div style={{ padding: block.props.padding || '16px 0', textAlign: (block.props as { align?: 'left' | 'center' | 'right' }).align || 'center', ...responsiveStyle }}><div style={{ borderTop: `1px solid ${block.props.color || '#e2e8f0'}`, fontSize: 0, lineHeight: 0 }}>&nbsp;</div></div>;
    if (block.type === 'spacer') return <div style={{ padding: (block.props as { padding?: string }).padding || '8px 0', textAlign: (block.props as { align?: 'left' | 'center' | 'right' }).align || 'center', height: block.props.height, lineHeight: `${block.props.height}px`, fontSize: block.props.height, ...responsiveStyle }}>&nbsp;</div>;
    if (block.type === 'product') {
        const productSelected = Boolean(block.props.productId || block.props.productName);
        const name = block.props.productName || 'Select a product';
        const image = block.props.productImage || '';
        const price = block.props.productPrice || '';
        const regularPrice = block.props.productRegularPrice || '';
        const description = block.props.productDescription || (productSelected ? '' : 'Choose a WooCommerce product in block settings.');
        const showTitle = block.props.showTitle !== false;
        const showButton = block.props.showButton !== false;
        return <div style={{ padding: (block.props as { padding?: string }).padding || '18px 0', textAlign: (block.props as { align?: 'left' | 'center' | 'right' }).align || 'center', ...responsiveStyle }}>{block.props.showImage && image && <img src={image} alt={name} width="220" style={{ display: 'block', maxWidth: '100%', height: 'auto', borderRadius: 10, margin: '0 auto 14px' }} />}{showTitle && <h3 style={{ margin: '0 0 8px', color: theme.textColor, fontSize: 20, lineHeight: 1.3 }}>{name}</h3>}{block.props.showDescription && description && <p style={{ margin: '0 0 10px', color: '#64748b', lineHeight: 1.6 }}>{description}</p>}{block.props.showPrice && price && <p style={{ margin: '0 0 8px', color: theme.primaryColor, fontWeight: 700 }}>{price}</p>}{block.props.showRegularPrice && regularPrice && <p style={{ margin: '0 0 14px', color: theme.mutedTextColor, fontSize: 14, textDecoration: block.props.showPrice && !!price ? 'line-through' : 'none' }}>{regularPrice}</p>}{showButton && <span style={{ display: 'inline-block', background: theme.primaryColor, color: '#ffffff', borderRadius: theme.borderRadius, padding: '10px 16px', fontWeight: 700 }}>{block.props.buttonLabel || 'View Product'}</span>}</div>;
    }
    if (block.type === 'orderSummary') {
        const itemsTag = block.props.itemsFormat === 'compact' ? '{{order.itemsCompact}}' : block.props.itemsFormat === 'list' ? '{{order.itemsList}}' : '{{order.itemsTable}}';
        return <div style={{ padding: (block.props as { padding?: string }).padding || '12px 0', textAlign: (block.props as { align?: 'left' | 'center' | 'right' }).align || 'left', ...responsiveStyle }}><h3 style={{ margin: '0 0 12px', color: theme.textColor, fontSize: 18 }}>{block.props.heading || 'Order summary'}</h3><div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, color: theme.mutedTextColor }}>{itemsTag}</div>{block.props.showTotals && <div style={{ margin: '14px 0 0', textAlign: 'right', color: theme.textColor }}><p style={{ margin: '0 0 4px', fontWeight: 600 }}>GST: {'{{order.taxTotal}}'}</p><p style={{ margin: 0, fontWeight: 700 }}>Total: {'{{order.total}}'}</p></div>}</div>;
    }
    if (block.type === 'cartItems') {
        return <div style={{ padding: block.props.padding || '12px 0', textAlign: block.props.align || 'left', ...responsiveStyle }}><h3 style={{ margin: '0 0 12px', color: theme.textColor, fontSize: 18 }}>{block.props.heading || 'Your cart'}</h3><div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, color: theme.mutedTextColor }}>{'{{cart.itemsTable}}'}</div>{block.props.showTotal && <div style={{ margin: '14px 0 0', textAlign: 'right', color: theme.textColor }}><p style={{ margin: 0, fontWeight: 700 }}>Cart total: {'{{cart.total}}'}</p></div>}</div>;
    }
    if (block.type === 'cartLink') {
        return <div style={{ padding: block.props.padding || '16px 0', textAlign: block.props.align || 'center', ...responsiveStyle }}>{block.props.body && <p style={{ margin: '0 0 14px', color: theme.mutedTextColor, lineHeight: 1.6 }}>{block.props.body}</p>}<span style={{ display: 'inline-block', background: block.props.backgroundColor || theme.primaryColor, color: block.props.color || '#ffffff', borderRadius: block.props.borderRadius ?? theme.borderRadius, padding: '12px 20px', fontWeight: 700, fontSize: 14 }}>{block.props.label || 'Return to your cart'}</span></div>;
    }
    if (block.type === 'orderTracking') {
        return <div style={{ padding: block.props.padding || '18px 0', textAlign: block.props.align || 'center', ...responsiveStyle }}><h3 style={{ margin: '0 0 8px', color: theme.textColor, fontSize: 18, lineHeight: 1.35 }}>{block.props.heading || 'Track your order'}</h3><p style={{ margin: '0 0 14px', color: theme.mutedTextColor, lineHeight: 1.6 }}>{block.props.body || 'Your order is on its way. Use the button below to track it with Australia Post.'}</p>{block.props.showTrackingNumber !== false && <p style={{ margin: '0 0 14px', color: theme.mutedTextColor, fontSize: 13, lineHeight: 1.4 }}>Tracking number: <strong style={{ color: theme.textColor }}>{'{{order.trackingNumber}}'}</strong></p>}<span style={{ display: 'inline-block', background: theme.primaryColor, color: '#ffffff', borderRadius: theme.borderRadius, padding: '12px 20px', fontWeight: 700, fontSize: 14 }}>{block.props.buttonLabel || 'Track with AusPost'}</span></div>;
    }
    if (block.type === 'address') return <div style={{ padding: (block.props as { padding?: string }).padding || '12px 0', textAlign: (block.props as { align?: 'left' | 'center' | 'right' }).align || 'left', ...responsiveStyle }}><h3 style={{ margin: '0 0 8px', color: theme.textColor, fontSize: 16 }}>{block.props.title}</h3><p style={{ margin: 0, color: theme.mutedTextColor, lineHeight: 1.6 }}>{block.props.source === 'shipping' ? '{{order.shippingAddress}}' : '{{order.billingAddress}}'}</p></div>;
    return <div style={{ padding: (block.props as { padding?: string }).padding || '8px 0', textAlign: (block.props as { align?: 'left' | 'center' | 'right' }).align || 'left', ...responsiveStyle }} dangerouslySetInnerHTML={{ __html: block.props.html }} />;
}

function EditableButtonBlock({ block, theme, onUpdate }: { block: Extract<EmailBlock, { type: 'button' }>; theme: EmailDesignTheme; onUpdate: (updater: (block: EmailBlock) => void) => void }) {
    const [isFocused, setIsFocused] = useState(false);
    const [showMergeTagModal, setShowMergeTagModal] = useState(false);
    const [mergeTagSearch, setMergeTagSearch] = useState('');
    const [mergeTagCategory, setMergeTagCategory] = useState<MergeTagDefinition['category']>('customer');
    const editorRef = useRef<HTMLSpanElement | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const textColorRef = useRef<HTMLInputElement | null>(null);
    const backgroundColorRef = useRef<HTMLInputElement | null>(null);
    const fontSize = block.props.fontSize || 14;
    const fontWeight = block.props.fontWeight || 700;
    const fontStyle = block.props.fontStyle || 'normal';
    const textDecoration = block.props.textDecoration || 'none';

    const syncLabel = () => {
        const editor = editorRef.current;
        if (editor) normalizeEditorDirection(editor);
        const nextLabel = sanitizeRtlText(editor?.textContent || 'Button');
        onUpdate((draft) => {
            if (draft.type === 'button') draft.props.label = nextLabel;
        });
    };

    const toggleDecoration = (value: 'underline' | 'line-through') => {
        onUpdate((draft) => {
            if (draft.type !== 'button') return;
            draft.props.textDecoration = (draft.props.textDecoration || 'none') === value ? 'none' : value;
        });
    };

    const visibleMergeTags = EMAIL_MERGE_TAGS.filter((tag) => {
        if (tag.category !== mergeTagCategory) return false;
        const term = mergeTagSearch.trim().toLowerCase();
        if (!term) return true;
        return tag.label.toLowerCase().includes(term) || tag.value.toLowerCase().includes(term);
    });

    const insertMergeTag = (value: string) => {
        editorRef.current?.focus();
        document.execCommand('insertText', false, value);
        syncLabel();
        setShowMergeTagModal(false);
    };

    return (
        <div ref={wrapperRef} className="relative">
            <div style={{ padding: block.props.padding || '16px 0', textAlign: block.props.align || 'center' }}>
                <span
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    dir="ltr"
                    onFocus={() => {
                        setIsFocused(true);
                        if (editorRef.current) normalizeEditorDirection(editorRef.current);
                    }}
                    onBlur={() => {
                        requestAnimationFrame(() => {
                            const active = document.activeElement;
                            if (wrapperRef.current?.contains(active)) return;
                            setIsFocused(false);
                            syncLabel();
                        });
                    }}
                    style={{
                        display: 'inline-block',
                        background: block.props.backgroundColor || theme.primaryColor,
                        color: block.props.color || '#ffffff',
                        borderRadius: block.props.borderRadius ?? theme.borderRadius,
                        padding: '12px 20px',
                        fontWeight,
                        fontStyle,
                        textDecoration,
                        fontSize,
                        direction: 'ltr',
                        unicodeBidi: 'isolate',
                        writingMode: 'horizontal-tb',
                        outline: 'none',
                    }}
                >
                    {block.props.label || 'Button'}
                </span>
            </div>

            {isFocused && (
                <div className="absolute left-0 top-full z-30 mt-2 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-white shadow-xl">
                    <select
                        className="rounded border border-slate-500 bg-slate-800 px-2 py-1 text-xs"
                        value={String(fontSize)}
                        onChange={(event) => {
                            const nextSize = Number(event.target.value);
                            onUpdate((draft) => {
                                if (draft.type === 'button') draft.props.fontSize = nextSize;
                            });
                        }}
                    >
                        <option value="13">13px</option>
                        <option value="14">14px</option>
                        <option value="15">15px</option>
                        <option value="16">16px</option>
                        <option value="18">18px</option>
                    </select>

                    <button type="button" className="rounded p-1.5 hover:bg-slate-700" onMouseDown={(event) => event.preventDefault()} onClick={() => onUpdate((draft) => { if (draft.type === 'button') draft.props.fontWeight = (draft.props.fontWeight || 700) >= 700 ? 500 : 700; })} title="Bold"><Bold size={14} /></button>
                    <button type="button" className="rounded p-1.5 hover:bg-slate-700" onMouseDown={(event) => event.preventDefault()} onClick={() => onUpdate((draft) => { if (draft.type === 'button') draft.props.fontStyle = (draft.props.fontStyle || 'normal') === 'italic' ? 'normal' : 'italic'; })} title="Italic"><Italic size={14} /></button>
                    <button type="button" className="rounded p-1.5 hover:bg-slate-700" onMouseDown={(event) => event.preventDefault()} onClick={() => toggleDecoration('underline')} title="Underline"><Underline size={14} /></button>
                    <button type="button" className="rounded p-1.5 hover:bg-slate-700" onMouseDown={(event) => event.preventDefault()} onClick={() => toggleDecoration('line-through')} title="Strikethrough"><Strikethrough size={14} /></button>

                    <div className="flex items-center gap-1 rounded border border-slate-600 bg-slate-800/70 px-1.5 py-1" title="Text color">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">Text</span>
                        <button type="button" className="flex h-5 w-5 items-center justify-center rounded border border-slate-500 bg-slate-800" onMouseDown={(event) => event.preventDefault()} onClick={() => textColorRef.current?.click()}>
                            <span className="h-3 w-3 rounded-full border border-slate-300" style={{ backgroundColor: block.props.color || '#ffffff' }} />
                        </button>
                    </div>
                    <input
                        ref={textColorRef}
                        type="color"
                        className="sr-only"
                        value={block.props.color || '#ffffff'}
                        onChange={(event) => {
                            const value = event.target.value;
                            onUpdate((draft) => {
                                if (draft.type === 'button') draft.props.color = value;
                            });
                        }}
                    />

                    <div className="flex items-center gap-1 rounded border border-slate-600 bg-slate-800/70 px-1.5 py-1" title="Button color">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">Button</span>
                        <button type="button" className="flex h-5 w-5 items-center justify-center rounded border border-slate-500 bg-slate-800" onMouseDown={(event) => event.preventDefault()} onClick={() => backgroundColorRef.current?.click()}>
                            <span className="h-3 w-3 rounded border border-slate-300" style={{ backgroundColor: block.props.backgroundColor || theme.primaryColor }} />
                        </button>
                    </div>
                    <input
                        ref={backgroundColorRef}
                        type="color"
                        className="sr-only"
                        value={block.props.backgroundColor || theme.primaryColor}
                        onChange={(event) => {
                            const value = event.target.value;
                            onUpdate((draft) => {
                                if (draft.type === 'button') draft.props.backgroundColor = value;
                            });
                        }}
                    />

                    <button
                        type="button"
                        className="rounded border border-slate-500 px-2 py-1 text-xs hover:bg-slate-700"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                            setMergeTagSearch('');
                            setMergeTagCategory('customer');
                            setShowMergeTagModal(true);
                        }}
                    >
                        Merge Tag
                    </button>

                    <button
                        type="button"
                        className="rounded border border-slate-500 px-2 py-1 text-xs hover:bg-slate-700"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                            onUpdate((draft) => {
                                if (draft.type === 'button') draft.props.href = '{{link_trigger}}';
                            });
                        }}
                    >
                        Link Trigger
                    </button>

                    <button
                        type="button"
                        className="rounded p-1.5 hover:bg-slate-700"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                            const url = window.prompt('Set button URL', block.props.href || 'https://');
                            if (!url) return;
                            onUpdate((draft) => {
                                if (draft.type === 'button') draft.props.href = url;
                            });
                        }}
                        title="Link"
                    >
                        <Link2 size={14} />
                    </button>
                </div>
            )}

            {showMergeTagModal && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-xs">
                    <div className="w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl">
                        <div className="flex items-center gap-4 border-b border-gray-200 px-5 py-4">
                            <h3 className="text-2xl font-medium text-gray-900">Merge Tags</h3>
                            <div className="ml-auto flex w-full max-w-xs items-center gap-2 rounded-lg border border-gray-300 px-3 py-2">
                                <Search className="h-4 w-4 text-gray-400" />
                                <input
                                    value={mergeTagSearch}
                                    onChange={(event) => setMergeTagSearch(sanitizeBidiText(event.target.value))}
                                    placeholder="Search by name"
                                    className="w-full border-0 text-sm text-gray-700 outline-none"
                                    dir="ltr"
                                    style={LTR_TEXT_STYLE}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowMergeTagModal(false)}
                                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                aria-label="Close merge tag modal"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="grid h-[520px] grid-cols-[180px_1fr]">
                            <div className="border-r border-gray-200 bg-gray-50">
                                {MERGE_TAG_CATEGORIES.map((category) => (
                                    <button
                                        key={category.id}
                                        type="button"
                                        onClick={() => setMergeTagCategory(category.id)}
                                        className={`flex w-full items-center px-4 py-3 text-left text-sm ${
                                            mergeTagCategory === category.id
                                                ? 'bg-white font-medium text-gray-900'
                                                : 'text-gray-600 hover:bg-gray-100'
                                        }`}
                                    >
                                        {category.label}
                                    </button>
                                ))}
                            </div>

                            <div className="overflow-y-auto">
                                {visibleMergeTags.length === 0 ? (
                                    <div className="p-8 text-sm text-gray-500">No merge tags found for that search.</div>
                                ) : (
                                    visibleMergeTags.map((tag) => (
                                        <div key={tag.value} className="flex items-center gap-4 border-b border-gray-100 px-6 py-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-gray-900">{tag.label}</p>
                                            </div>
                                            <code className="min-w-[220px] text-xs text-gray-500">{tag.value}</code>
                                            <button
                                                type="button"
                                                onClick={() => insertMergeTag(tag.value)}
                                                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                                title="Insert merge tag"
                                            >
                                                <Copy className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function getSocialPreviewStyle(iconStyle: SocialIconStyle, color: string): CSSProperties {
    return {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 6px',
        width: 34,
        height: 34,
        borderRadius: 999,
        outline: 'none',
        background: iconStyle === 'solid' ? color : 'transparent',
        border: iconStyle === 'glyph' ? 0 : `1.5px solid ${color}`,
        color: iconStyle === 'solid' ? '#ffffff' : color,
    };
}

function EditableTextBlock({ block, theme, onUpdate }: { block: Extract<EmailBlock, { type: 'text' }>; theme: EmailDesignTheme; onUpdate: (updater: (block: EmailBlock) => void) => void }) {
    const [isFocused, setIsFocused] = useState(false);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const size = block.props.size || 15;
    const align = block.props.align || 'left';
    const initialConfig = useMemo(() => ({
        namespace: `EmailTextBlock-${block.id}`,
        nodes: [HeadingNode, LinkNode, ListNode, ListItemNode],
        onError: (error: Error) => {
            console.error('Email text editor error', error);
        },
    }), [block.id]);

    const textStyle = useMemo<CSSProperties>(() => ({
        padding: block.props.padding || '8px 0',
        textAlign: align,
        direction: 'ltr',
        unicodeBidi: 'isolate',
        writingMode: 'horizontal-tb',
        fontSize: size,
        lineHeight: block.props.lineHeight || 1.6,
        color: block.props.color || theme.textColor,
        outline: 'none',
        minHeight: 36,
    }), [align, block.props.color, block.props.lineHeight, block.props.padding, size, theme.textColor]);


    return (
        <div
            ref={wrapperRef}
            className="relative"
            onFocusCapture={() => setIsFocused(true)}
            onBlurCapture={() => {
                requestAnimationFrame(() => {
                    const active = document.activeElement;
                    if (wrapperRef.current?.contains(active)) return;
                    setIsFocused(false);
                });
            }}
        >
            <style>{EMAIL_TEXT_EDITOR_CONTENT_STYLE}</style>
            <LexicalComposer initialConfig={initialConfig}>
                <EmailTextHtmlPlugin html={block.props.html} syncExternal={!isFocused} />
                <EmailTextOnChangePlugin currentHtml={block.props.html} onChange={(nextHtml) => {
                    onUpdate((draft) => {
                        if (draft.type === 'text') draft.props.html = nextHtml;
                    });
                }} />
                <EmailTextPastePlugin />
                <div style={textStyle}>
                    <RichTextPlugin
                        contentEditable={<ContentEditable className={EMAIL_TEXT_EDITOR_CONTENT_CLASS} ariaLabel="Email text block" />}
                        placeholder={<div className="pointer-events-none absolute text-sm text-slate-400">Write your text...</div>}
                        ErrorBoundary={LexicalErrorBoundary}
                    />
                </div>
                <HistoryPlugin />
                <LinkPlugin />
                <ListPlugin />
                {isFocused && <EmailTextToolbar block={block} theme={theme} onUpdate={onUpdate} />}
            </LexicalComposer>
        </div>
    );
}

function EmailTextHtmlPlugin({ html, syncExternal }: { html: string; syncExternal: boolean }) {
    const [editor] = useLexicalComposerContext();
    const didInitializeRef = useRef(false);
    const lastHtmlRef = useRef('');

    useEffect(() => {
        const nextHtml = sanitizeEmailHtml(html || '<p></p>');
        if (didInitializeRef.current && (!syncExternal || nextHtml === lastHtmlRef.current)) return;
        didInitializeRef.current = true;
        lastHtmlRef.current = nextHtml;
        editor.update(() => {
            replaceEditorHtml(editor, nextHtml);
        });
    }, [editor, html, syncExternal]);

    return null;
}

function replaceEditorHtml(editor: ReturnType<typeof useLexicalComposerContext>[0], html: string) {
    const root = $getRoot();
    root.clear();
    const parser = new DOMParser();
    const dom = parser.parseFromString(html, 'text/html');
    const nodes = $generateNodesFromDOM(editor, dom);
    if (nodes.length > 0) $insertNodes(nodes);
    else root.append($createParagraphNode());
}

function EmailTextOnChangePlugin({ currentHtml, onChange }: { currentHtml: string; onChange: (html: string) => void }) {
    const [editor] = useLexicalComposerContext();
    const currentHtmlRef = useRef(currentHtml);

    useEffect(() => {
        currentHtmlRef.current = currentHtml;
    }, [currentHtml]);

    useEffect(() => editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
            const nextHtml = sanitizeEmailHtml($generateHtmlFromNodes(editor));
            if (nextHtml && nextHtml !== currentHtmlRef.current) {
                currentHtmlRef.current = nextHtml;
                onChange(nextHtml);
            }
        });
    }), [editor, onChange]);

    return null;
}

function EmailTextPastePlugin() {
    const [editor] = useLexicalComposerContext();

    useEffect(() => editor.registerCommand<ClipboardEvent>(PASTE_COMMAND, (event) => {
        event.preventDefault();
        const pastedHtml = event.clipboardData?.getData('text/html') || '';
        const pastedText = event.clipboardData?.getData('text/plain') || '';
        const cleaned = sanitizeEmailPaste(pastedHtml, pastedText);
        editor.update(() => {
            const parser = new DOMParser();
            const dom = parser.parseFromString(cleaned, 'text/html');
            const nodes = $generateNodesFromDOM(editor, dom);
            const selection = $getSelection();
            if ($isRangeSelection(selection)) selection.insertNodes(nodes);
        });
        return true;
    }, COMMAND_PRIORITY_LOW), [editor]);

    return null;
}

function EmailTextToolbar({ block, theme, onUpdate }: { block: Extract<EmailBlock, { type: 'text' }>; theme: EmailDesignTheme; onUpdate: (updater: (block: EmailBlock) => void) => void }) {
    const [editor] = useLexicalComposerContext();
    const [showMergeTagPicker, setShowMergeTagPicker] = useState(false);
    const [mergeTagSearch, setMergeTagSearch] = useState('');
    const [isBold, setIsBold] = useState(false);
    const [isItalic, setIsItalic] = useState(false);
    const [isUnderline, setIsUnderline] = useState(false);
    const [isStrike, setIsStrike] = useState(false);
    const [isBulletList, setIsBulletList] = useState(false);
    const [isNumberList, setIsNumberList] = useState(false);
    const [hasSelection, setHasSelection] = useState(false);
    const [activeBlockType, setActiveBlockType] = useState<'p' | 'h1' | 'h2' | 'h3'>('p');
    const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>((block.props.align || 'left') as 'left' | 'center' | 'right');
    const textColorInputRef = useRef<HTMLInputElement | null>(null);
    const size = block.props.size || 15;

    const filteredMergeTags = EMAIL_MERGE_TAGS.filter((tag) => {
        const term = mergeTagSearch.trim().toLowerCase();
        if (!term) return true;
        return tag.label.toLowerCase().includes(term) || tag.value.toLowerCase().includes(term);
    });

    const updateToolbar = useCallback(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        setIsBold(selection.hasFormat('bold'));
        setIsItalic(selection.hasFormat('italic'));
        setIsUnderline(selection.hasFormat('underline'));
        setIsStrike(selection.hasFormat('strikethrough'));
        setHasSelection(!selection.isCollapsed());
        const anchorNode = selection.anchor.getNode();
        const topLevel = anchorNode.getTopLevelElementOrThrow?.();
        const type = topLevel?.getType?.();
        const tag = topLevel?.getTag?.();
        setActiveBlockType(type === 'heading' && (tag === 'h1' || tag === 'h2' || tag === 'h3') ? tag : 'p');
        const listType = topLevel?.getListType?.();
        setIsBulletList(listType === 'bullet');
        setIsNumberList(listType === 'number');
    }, []);

    useEffect(() => editor.registerCommand(SELECTION_CHANGE_COMMAND, () => {
        updateToolbar();
        return false;
    }, COMMAND_PRIORITY_LOW), [editor, updateToolbar]);

    useEffect(() => editor.registerUpdateListener(({ editorState }) => {
        editorState.read(updateToolbar);
    }), [editor, updateToolbar]);

    const buttonClass = (active = false) => `rounded p-1.5 transition ${active ? 'bg-slate-200 text-slate-900 ring-1 ring-slate-300' : 'hover:bg-slate-700'}`;

    const applyBlockType = (nextType: 'p' | 'h1' | 'h2' | 'h3') => {
        editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return;
            $setBlocksType(selection, () => nextType === 'p' ? $createParagraphNode() : $createHeadingNode(nextType));
        });
        setActiveBlockType(nextType);
    };

    const applyInlineStyle = (style: Record<string, string>, fallback?: () => void) => {
        editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection) && !selection.isCollapsed()) $patchStyleText(selection, style);
            else fallback?.();
        });
    };

    const applyBlockAlign = (nextAlign: 'left' | 'center' | 'right') => {
        setTextAlign(nextAlign);
        onUpdate((draft) => {
            if (draft.type === 'text') draft.props.align = nextAlign;
        });
    };

    const insertText = (value: string) => {
        editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) selection.insertText(value);
        });
    };

    const applyLink = (url: string, fallbackText = url) => {
        let isCollapsed = false;
        editor.getEditorState().read(() => {
            const selection = $getSelection();
            isCollapsed = $isRangeSelection(selection) ? selection.isCollapsed() : false;
        });
        if (!isCollapsed) {
            editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
            return;
        }
        editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return;
            const linkNode = $createLinkNode(url);
            linkNode.append($createTextNode(fallbackText));
            selection.insertNodes([linkNode]);
        });
    };

    return (
        <div className="absolute left-0 top-full z-30 mt-2 flex w-fit max-w-[95vw] flex-wrap items-center gap-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-white shadow-xl">
            <div className="absolute -top-1.5 left-5 h-3 w-3 rotate-45 border-l border-t border-slate-600 bg-slate-900" />
            <div className="flex items-center rounded-md border border-slate-600 bg-slate-800/80 p-0.5">
                {(['p', 'h1', 'h2', 'h3'] as const).map((value) => (
                    <button key={value} type="button" className={`rounded px-1.5 py-1 text-[11px] font-semibold ${activeBlockType === value ? 'bg-slate-200 text-slate-900' : 'text-slate-200 hover:bg-slate-700'}`} onMouseDown={(event) => event.preventDefault()} onClick={() => applyBlockType(value)}>{value.toUpperCase()}</button>
                ))}
            </div>
            <select className="rounded border border-slate-500 bg-slate-800 px-2 py-1 text-xs" defaultValue="Arial" onChange={(event) => applyInlineStyle({ 'font-family': event.target.value })}>
                <option value="Arial">Arial</option>
                <option value="Verdana">Verdana</option>
                <option value="Trebuchet MS">Trebuchet</option>
                <option value="Georgia">Georgia</option>
                <option value="Times New Roman">Times</option>
            </select>
            <select className="rounded border border-slate-500 bg-slate-800 px-2 py-1 text-xs" value={String(size)} onChange={(event) => {
                const next = Number(event.target.value);
                applyInlineStyle({ 'font-size': `${next}px` }, () => onUpdate((draft) => { if (draft.type === 'text') draft.props.size = next; }));
            }}>
                <option value="14">14px</option>
                <option value="15">15px</option>
                <option value="16">16px</option>
                <option value="18">18px</option>
                <option value="20">20px</option>
            </select>
            <span className="mx-0.5 h-5 w-px bg-slate-600" aria-hidden="true" />
            <button type="button" className={buttonClass(isBold)} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} title="Bold"><Bold size={14} /></button>
            <button type="button" className={buttonClass(isItalic)} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} title="Italic"><Italic size={14} /></button>
            <button type="button" className={buttonClass(isUnderline)} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')} title="Underline"><Underline size={14} /></button>
            <button type="button" className={buttonClass(isStrike)} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')} title="Strikethrough"><Strikethrough size={14} /></button>
            <button type="button" className={buttonClass(isBulletList)} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)} title="Bullet list"><List size={14} /></button>
            <button type="button" className={buttonClass(isNumberList)} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)} title="Numbered list"><ListOrdered size={14} /></button>
            <button type="button" className={buttonClass(textAlign === 'left')} onMouseDown={(event) => event.preventDefault()} onClick={() => applyBlockAlign('left')} title="Align left"><AlignLeft size={14} /></button>
            <button type="button" className={buttonClass(textAlign === 'center')} onMouseDown={(event) => event.preventDefault()} onClick={() => applyBlockAlign('center')} title="Align center"><AlignCenter size={14} /></button>
            <button type="button" className={buttonClass(textAlign === 'right')} onMouseDown={(event) => event.preventDefault()} onClick={() => applyBlockAlign('right')} title="Align right"><AlignRight size={14} /></button>
            <button type="button" className="flex h-7 items-center gap-1 rounded border border-slate-500 px-1.5 text-[11px] hover:bg-slate-700" onMouseDown={(event) => event.preventDefault()} onClick={() => textColorInputRef.current?.click()} title="Text color">
                <span className="h-3 w-3 rounded-full border border-slate-300" style={{ backgroundColor: block.props.color || theme.textColor }} />Text
            </button>
            <input ref={textColorInputRef} type="color" className="sr-only" value={block.props.color || theme.textColor} onChange={(event) => {
                const next = event.target.value;
                if (hasSelection) applyInlineStyle({ color: next });
                else onUpdate((draft) => { if (draft.type === 'text') draft.props.color = next; });
            }} />
            <button type="button" className={buttonClass(false)} onMouseDown={(event) => event.preventDefault()} onClick={() => {
                const url = window.prompt('Add link URL', 'https://');
                if (url) applyLink(url);
            }} title="Link"><Link2 size={14} /></button>
            <span className="mx-0.5 h-5 w-px bg-slate-600" aria-hidden="true" />
            <button type="button" className="rounded border border-slate-500 px-2 py-1 text-xs hover:bg-slate-700" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowMergeTagPicker((current) => !current)}>Merge Tag</button>
            <button type="button" className="rounded border border-slate-500 px-2 py-1 text-xs hover:bg-slate-700" onMouseDown={(event) => event.preventDefault()} onClick={() => applyLink('{{link_trigger}}', 'Link trigger')}>Link Trigger</button>
            {showMergeTagPicker && (
                <div className="absolute left-0 top-full z-40 mt-2 max-h-64 w-80 overflow-hidden rounded-lg border border-slate-600 bg-slate-950 shadow-2xl">
                    <div className="border-b border-slate-700 p-2"><input value={mergeTagSearch} onChange={(event) => setMergeTagSearch(sanitizeBidiText(event.target.value))} placeholder="Search merge tags" className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none" dir="ltr" style={LTR_TEXT_STYLE} /></div>
                    <div className="max-h-48 overflow-y-auto p-1">
                        {filteredMergeTags.map((tag) => <button key={tag.value} type="button" className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-slate-800" onMouseDown={(event) => event.preventDefault()} onClick={() => { insertText(tag.value); setShowMergeTagPicker(false); }}><span className="text-slate-200">{tag.label}</span><code className="text-[11px] text-slate-400">{tag.value}</code></button>)}
                        {filteredMergeTags.length === 0 && <div className="px-2 py-3 text-xs text-slate-400">No merge tags found.</div>}
                    </div>
                </div>
            )}
        </div>
    );
}

function normalizeEditorDirection(editor: HTMLElement): void {
    editor.setAttribute('dir', 'ltr');
    editor.style.direction = 'ltr';
    editor.style.unicodeBidi = 'isolate';
    editor.style.writingMode = 'horizontal-tb';

    editor.querySelectorAll<HTMLElement>('*').forEach((node) => {
        if (node.getAttribute('dir')?.toLowerCase() === 'rtl') node.removeAttribute('dir');
        if (node.style.direction === 'rtl') node.style.direction = 'ltr';
        if (node.style.unicodeBidi === 'bidi-override' || node.style.unicodeBidi === 'plaintext') node.style.unicodeBidi = 'isolate';
    });

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
        const textNode = current as Text;
        const cleaned = textNode.data.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, '');
        if (cleaned !== textNode.data) textNode.data = cleaned;
        current = walker.nextNode();
    }
}

function sanitizeRtlText(text: string): string {
    return stripBidiControls(text);
}
