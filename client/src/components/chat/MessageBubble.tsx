/**
 * MessageBubble - Renders a single message in the inbox chat.
 * Extracted from ChatWindow for better separation of concerns.
 * Features: HTML sanitization, quoted email collapsing, attachment previews, image lightbox trigger, message reactions.
 */
import React, { useState, useMemo, memo, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { format } from 'date-fns';
import { cn } from '../../utils/cn';
import { Check, AlertCircle, ChevronDown, ChevronUp, FileText, Download, Image as ImageIcon, File, Reply, Smile } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface MessageBubbleProps {
    message: {
        id: string;
        content: string;
        senderType: 'AGENT' | 'CUSTOMER' | 'SYSTEM';
        createdAt: string;
        isInternal: boolean;
        senderId?: string;
        readAt?: string | null;
        status?: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
        reactions?: Record<string, Array<{ userId: string; userName: string | null }>>;
    };
    recipientName?: string;
    onImageClick?: (src: string) => void;
    onQuoteReply?: (message: { id: string; content: string; senderType: string }) => void;
    onReactionToggle?: (messageId: string, emoji: string) => Promise<void>;
}

// Common reaction emojis
const REACTION_EMOJIS = ['👍', '❤️', '😊', '😂', '🎉', '👏'];

/**
 * Parses email content to extract subject line and body.
 */
function parseEmailContent(content: string): { subject: string | null; body: string } {
    if (content.startsWith('Subject:')) {
        const lines = content.split('\n');
        const subjectLine = lines[0].replace('Subject:', '').trim();
        const body = lines.slice(2).join('\n').trim();
        return { subject: subjectLine, body };
    }
    return { subject: null, body: content };
}

/**
 * Detects and separates quoted email content from the main message.
 * Recognizes patterns like "> quoted text", "On ... wrote:", "---Original Message---"
 */
function parseQuotedContent(body: string): { mainContent: string; quotedContent: string | null } {
    // Pattern 1: Lines starting with ">" (common email quote)
    const quoteStartPatterns = [
        /^On .+ wrote:$/m,
        /^-{3,}\s*Original Message\s*-{3,}$/mi,
        /^From:.+\nSent:.+\nTo:.+/m,
        /^_{3,}$/m,
    ];

    let splitIndex = -1;

    for (const pattern of quoteStartPatterns) {
        const match = body.match(pattern);
        if (match && match.index !== undefined) {
            if (splitIndex === -1 || match.index < splitIndex) {
                splitIndex = match.index;
            }
        }
    }

    // Also check for lines starting with ">"
    const lines = body.split('\n');
    let consecutiveQuotedLines = 0;
    let firstQuoteIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('>')) {
            consecutiveQuotedLines++;
            if (firstQuoteIndex === -1) firstQuoteIndex = i;
        } else {
            if (consecutiveQuotedLines >= 2 && firstQuoteIndex !== -1) {
                // Found a quoted section
                const charIndex = lines.slice(0, firstQuoteIndex).join('\n').length;
                if (splitIndex === -1 || charIndex < splitIndex) {
                    splitIndex = charIndex;
                }
            }
            consecutiveQuotedLines = 0;
            firstQuoteIndex = -1;
        }
    }

    if (splitIndex > 0) {
        return {
            mainContent: body.slice(0, splitIndex).trim(),
            quotedContent: body.slice(splitIndex).trim()
        };
    }

    return { mainContent: body, quotedContent: null };
}

/**
 * Extracts attachment info from message content.
 * Looks for common attachment patterns and URLs pointing to files.
 */
function extractAttachments(content: string): { type: 'image' | 'pdf' | 'document' | 'file'; url: string; filename: string }[] {
    const attachments: { type: 'image' | 'pdf' | 'document' | 'file'; url: string; filename: string }[] = [];

    // Match image tags
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(content)) !== null) {
        const url = match[1];
        const filename = url.split('/').pop() || 'image';
        attachments.push({ type: 'image', url, filename });
    }

    // Match anchor tags pointing to files
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    while ((match = linkRegex.exec(content)) !== null) {
        const url = match[1];
        const text = match[2];
        const ext = url.split('.').pop()?.toLowerCase() || '';

        if (['pdf'].includes(ext)) {
            attachments.push({ type: 'pdf', url, filename: text || url.split('/').pop() || 'document.pdf' });
        } else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
            attachments.push({ type: 'document', url, filename: text || url.split('/').pop() || 'document' });
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            attachments.push({ type: 'image', url, filename: text || url.split('/').pop() || 'image' });
        }
    }

    return attachments;
}

/**
 * Returns icon component for attachment type.
 */
function AttachmentIcon({ type }: { type: 'image' | 'pdf' | 'document' | 'file' }) {
    switch (type) {
        case 'image':
            return <ImageIcon size={16} />;
        case 'pdf':
            return <FileText size={16} className="text-red-500" />;
        case 'document':
            return <FileText size={16} className="text-blue-500" />;
        default:
            return <File size={16} />;
    }
}

/**
 * MessageBubble component - Memoized for performance.
 */
export const MessageBubble = memo(function MessageBubble({
    message,
    recipientName,
    onImageClick,
    onQuoteReply,
    onReactionToggle
}: MessageBubbleProps) {
    const [showQuoted, setShowQuoted] = useState(false);
    const [showHoverActions, setShowHoverActions] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const { user } = useAuth();

    const isMe = message.senderType === 'AGENT';
    const isSystem = message.senderType === 'SYSTEM';

    // Parse and process message content
    const { subject, body } = useMemo(() => parseEmailContent(message.content), [message.content]);
    const { mainContent, quotedContent } = useMemo(() => parseQuotedContent(body), [body]);
    const attachments = useMemo(() => extractAttachments(body), [body]);

    // Detect if content is HTML
    const isHtmlContent = useMemo(() => /<[a-z][\s\S]*>/i.test(mainContent), [mainContent]);

    // Sanitize HTML content
    const sanitizedContent = useMemo(() => {
        return DOMPurify.sanitize(mainContent, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'blockquote', 'div', 'span', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'width', 'height', 'style', 'class'],
            ALLOW_DATA_ATTR: false,
        });
    }, [mainContent]);

    const sanitizedQuotedContent = useMemo(() => {
        if (!quotedContent) return null;
        return DOMPurify.sanitize(quotedContent, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'div', 'span'],
            ALLOWED_ATTR: ['href', 'target'],
        });
    }, [quotedContent]);

    // Handle image clicks for lightbox
    const handleContentClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'IMG' && onImageClick) {
            e.preventDefault();
            onImageClick((target as HTMLImageElement).src);
        }
    };

    // System messages
    if (isSystem) {
        return (
            <div className="flex justify-center">
                <span className="text-gray-500 text-xs italic bg-white px-3 py-1 rounded-full shadow-sm">
                    {message.content}
                </span>
            </div>
        );
    }

    return (
        <div
            className={cn(
                "flex gap-2 group",
                isMe ? "justify-end" : "justify-start"
            )}
            onMouseEnter={() => setShowHoverActions(true)}
            onMouseLeave={() => setShowHoverActions(false)}
        >
            {/* Customer Avatar - Left side */}
            {!isMe && (
                <div className="w-7 h-7 rounded-full bg-gray-400 flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                    {(recipientName?.charAt(0) || 'C').toUpperCase()}
                </div>
            )}

            {/* Message Bubble */}
            <div
                className={cn(
                    "rounded-2xl px-3 py-2 shadow-sm relative",
                    isHtmlContent ? "max-w-[95%] w-full" : "max-w-[70%]",
                    isMe
                        ? "bg-blue-600 text-white rounded-br-md"
                        : "bg-white text-gray-800 rounded-bl-md border border-gray-100",
                    message.isInternal && "bg-yellow-100 text-yellow-900 border-yellow-200"
                )}
            >
                {/* Private Note Badge */}
                {message.isInternal && (
                    <div className="text-[10px] font-medium text-yellow-700 mb-1">
                        🔒 Private Note
                    </div>
                )}

                {/* Subject line for emails */}
                {subject && (
                    <div className={cn(
                        "text-xs font-semibold mb-1",
                        isMe ? "text-blue-100" : "text-gray-600"
                    )}>
                        {subject}
                    </div>
                )}

                {/* Main content */}
                <div
                    className={cn(
                        "text-sm break-words leading-relaxed",
                        !isHtmlContent && "whitespace-pre-wrap",
                        isHtmlContent && "email-content overflow-x-auto [&_table]:max-w-full [&_img]:max-w-full [&_img]:h-auto [&_img]:cursor-pointer"
                    )}
                    onClick={handleContentClick}
                    dangerouslySetInnerHTML={{ __html: sanitizedContent }}
                />

                {/* Quoted content (collapsible) */}
                {quotedContent && (
                    <div className="mt-2 pt-2 border-t border-gray-200/50">
                        <button
                            onClick={() => setShowQuoted(!showQuoted)}
                            className={cn(
                                "flex items-center gap-1 text-xs",
                                isMe ? "text-blue-200 hover:text-blue-100" : "text-gray-400 hover:text-gray-600"
                            )}
                        >
                            {showQuoted ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            {showQuoted ? 'Hide previous messages' : 'Show previous messages'}
                        </button>
                        {showQuoted && sanitizedQuotedContent && (
                            <div
                                className={cn(
                                    "mt-2 text-xs opacity-70 pl-2 border-l-2",
                                    isMe ? "border-blue-400" : "border-gray-300"
                                )}
                                dangerouslySetInnerHTML={{ __html: sanitizedQuotedContent }}
                            />
                        )}
                    </div>
                )}

                {/* Attachment Preview Cards */}
                {attachments.length > 0 && (
                    <div className="mt-2 space-y-1">
                        {attachments.filter(a => a.type !== 'image').map((attachment, idx) => (
                            <a
                                key={idx}
                                href={attachment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={cn(
                                    "flex items-center gap-2 p-2 rounded-lg transition-colors",
                                    isMe ? "bg-blue-500 hover:bg-blue-400" : "bg-gray-50 hover:bg-gray-100"
                                )}
                            >
                                <AttachmentIcon type={attachment.type} />
                                <span className="flex-1 text-xs truncate">{attachment.filename}</span>
                                <Download size={12} className="opacity-60" />
                            </a>
                        ))}
                    </div>
                )}

                {/* Timestamp and Status */}
                <div className={cn(
                    "text-[10px] mt-1 flex items-center gap-1",
                    isMe ? "text-blue-200 justify-end" : "text-gray-400"
                )}>
                    <span>{format(new Date(message.createdAt), 'h:mm a')}</span>
                    {/* Message status icons for agent messages */}
                    {isMe && !message.isInternal && (
                        <span className="flex items-center" title={message.status === 'FAILED' ? 'Failed to send' : 'Sent'}>
                            {message.status === 'FAILED' ? (
                                <AlertCircle size={12} className="text-red-400" />
                            ) : (
                                <Check size={12} className="text-blue-300" />
                            )}
                        </span>
                    )}
                </div>

                {/* Message Reactions Display */}
                {message.reactions && Object.keys(message.reactions).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(message.reactions).map(([emoji, users]) => (
                            <button
                                key={emoji}
                                onClick={() => onReactionToggle?.(message.id, emoji)}
                                className={cn(
                                    "flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs transition-colors",
                                    isMe
                                        ? "bg-blue-500 hover:bg-blue-400"
                                        : "bg-gray-100 hover:bg-gray-200",
                                    users.some(u => u.userId === user?.id) && "ring-1 ring-blue-400"
                                )}
                                title={users.map(u => u.userName || 'Unknown').join(', ')}
                            >
                                <span>{emoji}</span>
                                {users.length > 1 && <span className="opacity-70">{users.length}</span>}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Hover Actions - Emoji & Quote Reply */}
            {showHoverActions && (
                <div className="flex items-center gap-1">
                    {/* Emoji Picker Toggle */}
                    {onReactionToggle && (
                        <div className="relative">
                            <button
                                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                                className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Add reaction"
                            >
                                <Smile size={14} />
                            </button>
                            {showEmojiPicker && (
                                <div className={cn(
                                    "absolute z-20 bg-white rounded-lg shadow-lg border border-gray-200 p-1 flex gap-1",
                                    isMe ? "right-0" : "left-0",
                                    "top-full mt-1"
                                )}>
                                    {REACTION_EMOJIS.map(emoji => (
                                        <button
                                            key={emoji}
                                            onClick={() => {
                                                onReactionToggle(message.id, emoji);
                                                setShowEmojiPicker(false);
                                            }}
                                            className="p-1 hover:bg-gray-100 rounded text-lg"
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Quote Reply */}
                    {onQuoteReply && (
                        <button
                            onClick={() => onQuoteReply(message)}
                            className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Quote reply"
                        >
                            <Reply size={14} />
                        </button>
                    )}
                </div>
            )}

            {/* Agent Avatar - Right side */}
            {isMe && (
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                    ME
                </div>
            )}
        </div>
    );
});
