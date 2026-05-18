/**
 * ToolbarPlugin - Configurable toolbar with formatting buttons.
 * Renders buttons based on enabled features.
 */
import { useCallback, useEffect, useState, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
    $getSelection,
    $isRangeSelection,
    FORMAT_TEXT_COMMAND,
    SELECTION_CHANGE_COMMAND,
    COMMAND_PRIORITY_CRITICAL,
} from 'lexical';
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
    INSERT_ORDERED_LIST_COMMAND,
    INSERT_UNORDERED_LIST_COMMAND,
    ListNode,
} from '@lexical/list';
import { $getNearestNodeOfType } from '@lexical/utils';
import {
    Bold,
    Italic,
    Underline,
    Link,
    List,
    ListOrdered,
    Smile,
    AlignLeft,
    AlignCenter,
    AlignRight,
} from 'lucide-react';
import type { ReactNode } from 'react';

export type ToolbarFeature =
    | 'bold'
    | 'italic'
    | 'underline'
    | 'link'
    | 'list'
    | 'heading'
    | 'emoji'
    | 'image'
    | 'align'
    | 'mergeTag';

export interface MergeTagOption {
    label: string;
    value: string;
}

interface ToolbarPluginProps {
    features: ToolbarFeature[];
    rightSlot?: ReactNode;
    mergeTags?: MergeTagOption[];
}

// Common emojis for quick access
const EMOJI_LIST = [
    '😊', '😂', '❤️', '👍', '🙏', '🎉', '🔥', '✨',
    '👏', '💯', '🤝', '💪', '🙌', '✅', '⭐', '💡',
    '📦', '🚚', '💳', '📧', '📞', '🛒', '💰', '🎁',
];

export function ToolbarPlugin({ features, rightSlot, mergeTags = [] }: ToolbarPluginProps) {
    const [editor] = useLexicalComposerContext();
    const [isBold, setIsBold] = useState(false);
    const [isItalic, setIsItalic] = useState(false);
    const [isUnderline, setIsUnderline] = useState(false);
    const [isLink, setIsLink] = useState(false);
    const [listType, setListType] = useState<'bullet' | 'number' | null>(null);
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [linkUrl, setLinkUrl] = useState('');
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const emojiPickerRef = useRef<HTMLDivElement>(null);

    const updateToolbar = useCallback(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
            setIsBold(selection.hasFormat('bold'));
            setIsItalic(selection.hasFormat('italic'));
            setIsUnderline(selection.hasFormat('underline'));

            // Check for link
            const node = selection.anchor.getNode();
            const parent = node.getParent();
            setIsLink($isLinkNode(parent) || $isLinkNode(node));

            // Check for list
            const anchorNode = selection.anchor.getNode();
            const element = anchorNode.getKey() === 'root'
                ? anchorNode
                : anchorNode.getTopLevelElementOrThrow();
            const elementDOM = editor.getElementByKey(element.getKey());

            if (elementDOM !== null) {
                const listNode = $getNearestNodeOfType<ListNode>(anchorNode, ListNode);
                if (listNode) {
                    setListType(listNode.getListType() === 'bullet' ? 'bullet' : 'number');
                } else {
                    setListType(null);
                }
            }
        }
    }, [editor]);

    useEffect(() => {
        return editor.registerCommand(
            SELECTION_CHANGE_COMMAND,
            () => {
                updateToolbar();
                return false;
            },
            COMMAND_PRIORITY_CRITICAL
        );
    }, [editor, updateToolbar]);

    // Close emoji picker when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
                setShowEmojiPicker(false);
            }
        };
        if (showEmojiPicker) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showEmojiPicker]);

    const formatBold = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
    const formatItalic = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
    const formatUnderline = () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline');

    const insertLink = () => {
        if (isLink) {
            editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
        } else {
            setLinkUrl('https://');
            setShowLinkModal(true);
        }
    };

    const confirmLink = () => {
        if (linkUrl && linkUrl !== 'https://') {
            editor.dispatchCommand(TOGGLE_LINK_COMMAND, linkUrl);
        }
        setShowLinkModal(false);
        setLinkUrl('');
    };

    const insertBulletList = () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    const insertNumberedList = () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    const formatAlignment = (value: 'left' | 'center' | 'right') => {
        editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return;
            const anchorNode = selection.anchor.getNode();
            const element = anchorNode.getTopLevelElementOrThrow();
            element.setFormat(value);
        });
    };

    const alignLeft = () => formatAlignment('left');
    const alignCenter = () => formatAlignment('center');
    const alignRight = () => formatAlignment('right');

    // Insert emoji at cursor position
    const insertEmoji = (emoji: string) => {
        editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
                selection.insertText(emoji);
            }
        });
        setShowEmojiPicker(false);
    };

    const has = (feature: ToolbarFeature) => features.includes(feature);

    const insertMergeTag = (value: string) => {
        if (!value) return;
        editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) selection.insertText(value);
        });
    };

    return (
        <>
            <div className="rte-toolbar">
                <div className="rte-toolbar-main">
                    {/* Text Formatting Group */}
                    {(has('bold') || has('italic') || has('underline')) && (
                        <div className="rte-toolbar-group">
                            {has('bold') && (
                                <button
                                    type="button"
                                    onClick={formatBold}
                                    className={`rte-toolbar-btn ${isBold ? 'active' : ''}`}
                                    title="Bold (Ctrl+B)"
                                    aria-label="Format Bold"
                                >
                                    <Bold size={16} />
                                </button>
                            )}
                            {has('italic') && (
                                <button
                                    type="button"
                                    onClick={formatItalic}
                                    className={`rte-toolbar-btn ${isItalic ? 'active' : ''}`}
                                    title="Italic (Ctrl+I)"
                                    aria-label="Format Italic"
                                >
                                    <Italic size={16} />
                                </button>
                            )}
                            {has('underline') && (
                                <button
                                    type="button"
                                    onClick={formatUnderline}
                                    className={`rte-toolbar-btn ${isUnderline ? 'active' : ''}`}
                                    title="Underline (Ctrl+U)"
                                    aria-label="Format Underline"
                                >
                                    <Underline size={16} />
                                </button>
                            )}
                        </div>
                    )}

                    {/* Link */}
                    {has('link') && (
                        <div className="rte-toolbar-group">
                            <button
                                type="button"
                                onClick={insertLink}
                                className={`rte-toolbar-btn ${isLink ? 'active' : ''}`}
                                title="Insert Link"
                                aria-label="Insert Link"
                            >
                                <Link size={16} />
                            </button>
                        </div>
                    )}

                    {/* Lists */}
                    {has('list') && (
                        <div className="rte-toolbar-group">
                            <button
                                type="button"
                                onClick={insertBulletList}
                                className={`rte-toolbar-btn ${listType === 'bullet' ? 'active' : ''}`}
                                title="Bullet List"
                                aria-label="Insert Bullet List"
                            >
                                <List size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={insertNumberedList}
                                className={`rte-toolbar-btn ${listType === 'number' ? 'active' : ''}`}
                                title="Numbered List"
                                aria-label="Insert Numbered List"
                            >
                                <ListOrdered size={16} />
                            </button>
                        </div>
                    )}

                    {has('align') && (
                        <div className="rte-toolbar-group">
                            <button type="button" onClick={alignLeft} className="rte-toolbar-btn" title="Align Left" aria-label="Align Left">
                                <AlignLeft size={16} />
                            </button>
                            <button type="button" onClick={alignCenter} className="rte-toolbar-btn" title="Align Center" aria-label="Align Center">
                                <AlignCenter size={16} />
                            </button>
                            <button type="button" onClick={alignRight} className="rte-toolbar-btn" title="Align Right" aria-label="Align Right">
                                <AlignRight size={16} />
                            </button>
                        </div>
                    )}

                    {has('mergeTag') && mergeTags.length > 0 && (
                        <div className="rte-toolbar-group">
                            <select
                                className="rte-toolbar-select"
                                defaultValue=""
                                onChange={(event) => {
                                    const value = event.target.value;
                                    insertMergeTag(value);
                                    event.currentTarget.value = '';
                                }}
                                aria-label="Insert merge tag"
                            >
                                <option value="">Merge Tags</option>
                                {mergeTags.map((tag) => (
                                    <option key={tag.value} value={tag.value}>{tag.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Emoji Picker */}
                    {has('emoji') && (
                        <div className="rte-toolbar-group" style={{ position: 'relative' }} ref={emojiPickerRef}>
                            <button
                                type="button"
                                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                                className={`rte-toolbar-btn ${showEmojiPicker ? 'active' : ''}`}
                                title="Insert Emoji"
                                aria-label="Insert Emoji"
                            >
                                <Smile size={16} />
                            </button>
                            {showEmojiPicker && (
                                <div className="rte-emoji-picker">
                                    {EMOJI_LIST.map((emoji) => (
                                        <button
                                            key={emoji}
                                            type="button"
                                            className="rte-emoji-btn"
                                            onClick={() => insertEmoji(emoji)}
                                            title={emoji}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                {rightSlot && <div className="rte-toolbar-right">{rightSlot}</div>}
            </div>

            {/* Link Modal */}
            {showLinkModal && (
                <div className="rte-link-modal-overlay" onClick={() => setShowLinkModal(false)}>
                    <div className="rte-link-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Insert Link</h3>
                        <input
                            type="url"
                            value={linkUrl}
                            onChange={(e) => setLinkUrl(e.target.value)}
                            placeholder="Enter URL..."
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') confirmLink();
                                if (e.key === 'Escape') setShowLinkModal(false);
                            }}
                        />
                        <div className="rte-link-modal-actions">
                            <button
                                type="button"
                                className="rte-link-modal-btn cancel"
                                onClick={() => setShowLinkModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="rte-link-modal-btn confirm"
                                onClick={confirmLink}
                            >
                                Insert
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
