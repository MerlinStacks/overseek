import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Link2, List, ListOrdered, Strikethrough, Underline } from 'lucide-react';
import { getSocialIconSvg } from '../../../lib/emailDesignerV2';
import type { EmailBlock, EmailDesignTheme, SocialIconStyle } from '../../../lib/emailDesignerV2';
import { EMAIL_MERGE_TAGS } from './mergeTags';

export function LiveBlock({ block, theme, onUpdate }: { block: EmailBlock; theme: EmailDesignTheme; onUpdate: (updater: (block: EmailBlock) => void) => void }) {
    if (block.type === 'siteLogo') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center' }}>{block.props.src ? <img src={block.props.src} alt={block.props.alt || block.props.fallbackText || 'Logo'} width={block.props.width || 160} style={{ display: 'block', maxWidth: '100%', height: 'auto', border: 0, margin: '0 auto' }} /> : <h1 style={{ margin: 0, color: theme.textColor, fontSize: 28, lineHeight: 1.25 }}>{block.props.fallbackText || block.props.alt || 'Your Store'}</h1>}</div>;
    }
    if (block.type === 'text') {
        return <EditableTextBlock block={block} theme={theme} onUpdate={onUpdate} />;
    }
    if (block.type === 'button') {
        return <EditableButtonBlock block={block} theme={theme} onUpdate={onUpdate} />;
    }
    if (block.type === 'list') {
        const Tag = block.props.ordered ? 'ol' : 'ul';
        return <div style={{ padding: block.props.padding || '8px 0', color: block.props.color || theme.textColor }}><Tag style={{ margin: 0, paddingLeft: 22, lineHeight: 1.6 }}>{block.props.items.map((item, index) => <li key={index} contentEditable suppressContentEditableWarning onBlur={(event) => {
            const nextItem = event.currentTarget.textContent || '';
            onUpdate((draft) => {
                if (draft.type === 'list') draft.props.items[index] = nextItem;
            });
        }} style={{ margin: '0 0 6px', outline: 'none' }}>{item}</li>)}</Tag></div>;
    }
    if (block.type === 'image') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center' }}><img src={block.props.src} alt={block.props.alt || ''} width={block.props.width || 560} style={{ display: 'block', maxWidth: '100%', height: 'auto', border: 0, margin: '0 auto' }} /></div>;
    }
    if (block.type === 'coupon') {
        return <div style={{ padding: 18, margin: '8px 0', background: '#eef2ff', border: `1px dashed ${theme.primaryColor}`, borderRadius: theme.borderRadius, textAlign: 'center' }}><p contentEditable suppressContentEditableWarning onBlur={(event) => {
            const nextHeadline = event.currentTarget.textContent || '';
            onUpdate((draft) => {
                if (draft.type === 'coupon') draft.props.headline = nextHeadline;
            });
        }} style={{ margin: '0 0 6px', color: theme.textColor, fontSize: 18, fontWeight: 700, outline: 'none' }}>{block.props.headline}</p><p style={{ margin: '0 0 8px', color: theme.primaryColor, fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>{block.props.code || '{{coupon.code}}'}</p><p style={{ margin: 0, color: theme.mutedTextColor, lineHeight: 1.5 }}>{block.props.description || '{{coupon.description}}'}</p></div>;
    }
    if (block.type === 'social') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center', fontSize: 14, lineHeight: 1.5 }}>{block.props.links.map((link, index) => { const iconStyle = link.iconStyle || block.props.iconStyle || 'solid'; return <span key={`${link.label}-${index}`} style={getSocialPreviewStyle(iconStyle, block.props.color || theme.primaryColor)} title={link.label}><span dangerouslySetInnerHTML={{ __html: getSocialIconSvg(link.label, iconStyle, block.props.color || theme.primaryColor) }} /></span>; })}</div>;
    }
    if (block.type === 'menu') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center', fontSize: 14, lineHeight: 1.5 }}>{block.props.links.map((link, index) => <span key={`${link.label}-${index}`} contentEditable suppressContentEditableWarning onBlur={(event) => {
            const nextLabel = event.currentTarget.textContent || link.label;
            onUpdate((draft) => {
                if (draft.type === block.type) draft.props.links[index].label = nextLabel;
            });
        }} style={{ display: 'inline-block', margin: '0 10px', color: block.props.color || theme.primaryColor, fontWeight: 600, outline: 'none' }}>{link.label}</span>)}</div>;
    }
    if (block.type === 'footer') {
        return <div style={{ padding: block.props.padding || '8px 0', textAlign: block.props.align || 'center', fontSize: 12, lineHeight: 1.6, color: block.props.color || theme.mutedTextColor }} dangerouslySetInnerHTML={{ __html: block.props.html || '<p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>' }} />;
    }
    if (block.type === 'divider') return <div style={{ padding: block.props.padding || '16px 0' }}><div style={{ borderTop: `1px solid ${block.props.color || '#e2e8f0'}`, fontSize: 0, lineHeight: 0 }}>&nbsp;</div></div>;
    if (block.type === 'spacer') return <div style={{ height: block.props.height, lineHeight: `${block.props.height}px`, fontSize: block.props.height }}>&nbsp;</div>;
    if (block.type === 'product') {
        const name = block.props.productName || 'Select a product';
        const image = block.props.productImage || '';
        const price = block.props.productPrice || '';
        const description = block.props.productDescription || 'Choose a WooCommerce product in block settings.';
        return <div style={{ padding: '18px 0', textAlign: 'center' }}>{block.props.showImage && image && <img src={image} alt={name} width="220" style={{ display: 'block', maxWidth: '100%', height: 'auto', borderRadius: 10, margin: '0 auto 14px' }} />}<h3 style={{ margin: '0 0 8px', color: theme.textColor, fontSize: 20, lineHeight: 1.3 }}>{name}</h3>{block.props.showDescription && <p style={{ margin: '0 0 10px', color: '#64748b', lineHeight: 1.6 }}>{description}</p>}{block.props.showPrice && price && <p style={{ margin: '0 0 14px', color: theme.primaryColor, fontWeight: 700 }}>{price}</p>}<span style={{ display: 'inline-block', background: theme.primaryColor, color: '#ffffff', borderRadius: theme.borderRadius, padding: '10px 16px', fontWeight: 700 }}>{block.props.buttonLabel || 'View Product'}</span></div>;
    }
    if (block.type === 'orderSummary') return <div style={{ padding: '12px 0' }}><h3 style={{ margin: '0 0 12px', color: theme.textColor, fontSize: 18 }}>{block.props.heading || 'Order summary'}</h3><div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, color: theme.mutedTextColor }}>{'{{order.itemsTable}}'}</div>{block.props.showTotals && <p style={{ textAlign: 'right', fontWeight: 700, color: theme.textColor }}>Total: {'{{order.total}}'}</p>}</div>;
    if (block.type === 'address') return <div style={{ padding: '12px 0' }}><h3 style={{ margin: '0 0 8px', color: theme.textColor, fontSize: 16 }}>{block.props.title}</h3><p style={{ margin: 0, color: theme.mutedTextColor, lineHeight: 1.6 }}>{block.props.source === 'shipping' ? '{{order.shippingAddress}}' : '{{order.billingAddress}}'}</p></div>;
    return <div dangerouslySetInnerHTML={{ __html: block.props.html }} />;
}

function EditableButtonBlock({ block, theme, onUpdate }: { block: Extract<EmailBlock, { type: 'button' }>; theme: EmailDesignTheme; onUpdate: (updater: (block: EmailBlock) => void) => void }) {
    const [isFocused, setIsFocused] = useState(false);
    const editorRef = useRef<HTMLSpanElement | null>(null);
    const fontSize = block.props.fontSize || 14;
    const fontWeight = block.props.fontWeight || 700;
    const fontStyle = block.props.fontStyle || 'normal';
    const textDecoration = block.props.textDecoration || 'none';

    const syncLabel = () => {
        const nextLabel = editorRef.current?.textContent || 'Button';
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

    return (
        <div className="relative">
            <div style={{ padding: block.props.padding || '16px 0', textAlign: block.props.align || 'center' }}>
                <span
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => {
                        setIsFocused(false);
                        syncLabel();
                    }}
                    onInput={syncLabel}
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
                        onMouseDown={(event) => event.preventDefault()}
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

                    <label className="flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-slate-500 bg-slate-800">
                        <span className="h-4 w-4 rounded-full border border-slate-300" style={{ backgroundColor: block.props.color || '#ffffff' }} />
                        <input
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
                    </label>

                    <button
                        type="button"
                        className="rounded border border-slate-500 px-2 py-1 text-xs hover:bg-slate-700"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                            editorRef.current?.focus();
                            document.execCommand('insertText', false, '{{customer.firstName}}');
                            syncLabel();
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
    const [showMergeTagPicker, setShowMergeTagPicker] = useState(false);
    const [mergeTagSearch, setMergeTagSearch] = useState('');
    const [isBold, setIsBold] = useState(false);
    const [isItalic, setIsItalic] = useState(false);
    const [isUnderline, setIsUnderline] = useState(false);
    const [isStrike, setIsStrike] = useState(false);
    const [isBulletList, setIsBulletList] = useState(false);
    const [isNumberList, setIsNumberList] = useState(false);
    const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>((block.props.align || 'left') as 'left' | 'center' | 'right');
    const editorRef = useRef<HTMLDivElement | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const size = block.props.size || 15;
    const align = block.props.align || 'left';
    const blockType = block.props.html.trim().toLowerCase().startsWith('<h1') ? 'h1' : block.props.html.trim().toLowerCase().startsWith('<h2') ? 'h2' : block.props.html.trim().toLowerCase().startsWith('<h3') ? 'h3' : 'p';

    const textStyle = useMemo<CSSProperties>(() => ({
        padding: block.props.padding || '8px 0',
        textAlign: align,
        fontSize: size,
        lineHeight: block.props.lineHeight || 1.6,
        color: block.props.color || theme.textColor,
        outline: 'none',
        minHeight: 36,
    }), [align, block.props.color, block.props.lineHeight, block.props.padding, size, theme.textColor]);

    const syncHtml = () => {
        const nextHtml = editorRef.current?.innerHTML || '';
        onUpdate((draft) => {
            if (draft.type === 'text') draft.props.html = nextHtml;
        });
    };

    const filteredMergeTags = EMAIL_MERGE_TAGS.filter((tag) => {
        const term = mergeTagSearch.trim().toLowerCase();
        if (!term) return true;
        return tag.label.toLowerCase().includes(term) || tag.value.toLowerCase().includes(term);
    });

    useEffect(() => {
        if (!isFocused) return;

        const refreshToolbarState = () => {
            setIsBold(Boolean(document.queryCommandState('bold')));
            setIsItalic(Boolean(document.queryCommandState('italic')));
            setIsUnderline(Boolean(document.queryCommandState('underline')));
            setIsStrike(Boolean(document.queryCommandState('strikeThrough')));
            setIsBulletList(Boolean(document.queryCommandState('insertUnorderedList')));
            setIsNumberList(Boolean(document.queryCommandState('insertOrderedList')));
            if (document.queryCommandState('justifyCenter')) setTextAlign('center');
            else if (document.queryCommandState('justifyRight')) setTextAlign('right');
            else setTextAlign('left');
        };

        refreshToolbarState();
        document.addEventListener('selectionchange', refreshToolbarState);
        return () => {
            document.removeEventListener('selectionchange', refreshToolbarState);
        };
    }, [isFocused]);

    const buttonClass = (active = false) => `rounded p-1.5 transition ${active ? 'bg-slate-200 text-slate-900 ring-1 ring-slate-300' : 'hover:bg-slate-700'}`;

    return (
        <div ref={wrapperRef} className="relative">
            <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onFocus={() => setIsFocused(true)}
                onBlur={() => {
                    requestAnimationFrame(() => {
                        const active = document.activeElement;
                        if (wrapperRef.current?.contains(active)) return;
                        setIsFocused(false);
                        setShowMergeTagPicker(false);
                        syncHtml();
                    });
                }}
                onInput={syncHtml}
                dangerouslySetInnerHTML={{ __html: block.props.html }}
                style={textStyle}
            />
            {isFocused && (
                <div className="absolute left-0 top-full z-30 mt-2 flex w-fit max-w-[95vw] flex-wrap items-center gap-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-white shadow-xl">
                    <div className="absolute -top-1.5 left-5 h-3 w-3 rotate-45 border-l border-t border-slate-600 bg-slate-900" />

                    <div className="flex items-center rounded-md border border-slate-600 bg-slate-800/80 p-0.5">
                        {[
                            { value: 'p', label: 'P' },
                            { value: 'h1', label: 'H1' },
                            { value: 'h2', label: 'H2' },
                            { value: 'h3', label: 'H3' },
                        ].map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className={`rounded px-1.5 py-1 text-[11px] font-semibold ${blockType === item.value ? 'bg-slate-200 text-slate-900' : 'text-slate-200 hover:bg-slate-700'}`}
                                onClick={() => {
                                    editorRef.current?.focus();
                                    document.execCommand('formatBlock', false, item.value);
                                    syncHtml();
                                }}
                                title={item.value === 'p' ? 'Paragraph' : `Heading ${item.value.slice(1)}`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    <select
                        className="rounded border border-slate-500 bg-slate-800 px-2 py-1 text-xs"
                        defaultValue="Arial"
                        title="Font Family"
                        onChange={(event) => {
                            editorRef.current?.focus();
                            document.execCommand('fontName', false, event.target.value);
                            syncHtml();
                        }}
                    >
                        <option value="Arial">Arial</option>
                        <option value="Verdana">Verdana</option>
                        <option value="Trebuchet MS">Trebuchet</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Times New Roman">Times</option>
                    </select>

                    <select
                        className="rounded border border-slate-500 bg-slate-800 px-2 py-1 text-xs"
                        value={String(size)}
                        title="Font Size"
                        onChange={(event) => {
                            const next = Number(event.target.value);
                            editorRef.current?.focus();
                            document.execCommand('fontSize', false, '7');
                            const editor = editorRef.current;
                            if (editor) {
                                editor.querySelectorAll('font[size="7"]').forEach((node) => {
                                    node.removeAttribute('size');
                                    (node as HTMLElement).style.fontSize = `${next}px`;
                                });
                            }
                            onUpdate((draft) => {
                                if (draft.type === 'text') draft.props.size = next;
                            });
                            syncHtml();
                        }}
                    >
                        <option value="14">14px</option>
                        <option value="15">15px</option>
                        <option value="16">16px</option>
                        <option value="18">18px</option>
                        <option value="20">20px</option>
                    </select>

                    <span className="mx-0.5 h-5 w-px bg-slate-600" aria-hidden="true" />

                    <button type="button" className={buttonClass(isBold)} onMouseDown={(event) => event.preventDefault()} onClick={() => document.execCommand('bold')} title="Bold"><Bold size={14} /></button>
                    <button type="button" className={buttonClass(isItalic)} onMouseDown={(event) => event.preventDefault()} onClick={() => document.execCommand('italic')} title="Italic"><Italic size={14} /></button>
                    <button type="button" className={buttonClass(isUnderline)} onMouseDown={(event) => event.preventDefault()} onClick={() => document.execCommand('underline')} title="Underline"><Underline size={14} /></button>
                    <button type="button" className={buttonClass(isStrike)} onMouseDown={(event) => event.preventDefault()} onClick={() => document.execCommand('strikeThrough')} title="Strikethrough"><Strikethrough size={14} /></button>
                    <button type="button" className={buttonClass(isBulletList)} onMouseDown={(event) => event.preventDefault()} onClick={() => document.execCommand('insertUnorderedList')} title="Bullet list"><List size={14} /></button>
                    <button type="button" className={buttonClass(isNumberList)} onMouseDown={(event) => event.preventDefault()} onClick={() => document.execCommand('insertOrderedList')} title="Numbered list"><ListOrdered size={14} /></button>
                    <button type="button" className={buttonClass(textAlign === 'left')} onMouseDown={(event) => event.preventDefault()} onClick={() => document.execCommand('justifyLeft')} title="Align left"><AlignLeft size={14} /></button>
                    <button type="button" className={buttonClass(textAlign === 'center')} onMouseDown={(event) => event.preventDefault()} onClick={() => document.execCommand('justifyCenter')} title="Align center"><AlignCenter size={14} /></button>
                    <button type="button" className={buttonClass(textAlign === 'right')} onMouseDown={(event) => event.preventDefault()} onClick={() => document.execCommand('justifyRight')} title="Align right"><AlignRight size={14} /></button>
                    <button
                        type="button"
                        className={buttonClass(false)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                            editorRef.current?.focus();
                            const url = window.prompt('Add link URL', 'https://');
                            if (url) {
                                document.execCommand('createLink', false, url);
                                syncHtml();
                            }
                        }}
                        title="Link"
                    >
                        <Link2 size={14} />
                    </button>

                    <span className="mx-0.5 h-5 w-px bg-slate-600" aria-hidden="true" />

                    <button
                        type="button"
                        className="rounded border border-slate-500 px-2 py-1 text-xs hover:bg-slate-700"
                        title="Merge Tag"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                            setShowMergeTagPicker((current) => !current);
                        }}
                    >
                        Merge Tag
                    </button>

                    <button
                        type="button"
                        className="rounded border border-slate-500 px-2 py-1 text-xs hover:bg-slate-700"
                        title="Link Trigger"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                            editorRef.current?.focus();
                            document.execCommand('createLink', false, '{{link_trigger}}');
                            syncHtml();
                        }}
                    >
                        Link Trigger
                    </button>

                    {showMergeTagPicker && (
                        <div className="absolute left-0 top-full z-40 mt-2 max-h-64 w-80 overflow-hidden rounded-lg border border-slate-600 bg-slate-950 shadow-2xl">
                            <div className="border-b border-slate-700 p-2">
                                <input
                                    value={mergeTagSearch}
                                    onChange={(event) => setMergeTagSearch(event.target.value)}
                                    placeholder="Search merge tags"
                                    className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none"
                                />
                            </div>
                            <div className="max-h-48 overflow-y-auto p-1">
                                {filteredMergeTags.map((tag) => (
                                    <button
                                        key={tag.value}
                                        type="button"
                                        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-slate-800"
                                        onClick={() => {
                                            editorRef.current?.focus();
                                            document.execCommand('insertText', false, tag.value);
                                            setShowMergeTagPicker(false);
                                            syncHtml();
                                        }}
                                    >
                                        <span className="text-slate-200">{tag.label}</span>
                                        <code className="text-[11px] text-slate-400">{tag.value}</code>
                                    </button>
                                ))}
                                {filteredMergeTags.length === 0 && (
                                    <div className="px-2 py-3 text-xs text-slate-400">No merge tags found.</div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
