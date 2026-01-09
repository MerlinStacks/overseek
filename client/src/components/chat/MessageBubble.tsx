/**
 * MessageBubble - Renders a single message in the inbox.
 * Redesigned to display emails in a traditional email reader format (like Gmail/Outlook)
 * rather than chat bubbles. Shows sender header, date, and clean body layout.
 */
import React, { useState, useMemo, memo } from 'react';
import DOMPurify from 'dompurify';
import { format } from 'date-fns';
import { cn } from '../../utils/cn';
import { Check, AlertCircle, ChevronDown, ChevronUp, FileText, Download, Image as ImageIcon, File, Reply, CornerDownRight, User, Send } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

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
 */
function parseQuotedContent(body: string): { mainContent: string; quotedContent: string | null } {
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

    const lines = body.split('\n');
    let consecutiveQuotedLines = 0;
    let firstQuoteIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('>')) {
            consecutiveQuotedLines++;
            if (firstQuoteIndex === -1) firstQuoteIndex = i;
        } else {
            if (consecutiveQuotedLines >= 2 && firstQuoteIndex !== -1) {
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
 */
function extractAttachments(content: string): { type: 'image' | 'pdf' | 'document' | 'file'; url: string; filename: string }[] {
    const attachments: { type: 'image' | 'pdf' | 'document' | 'file'; url: string; filename: string }[] = [];

    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(content)) !== null) {
        const url = match[1];
        const filename = url.split('/').pop() || 'image';
        attachments.push({ type: 'image', url, filename });
    }

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
 * MessageBubble component - Traditional email reader format
 */
export const MessageBubble = memo(function MessageBubble({
    message,
    recipientName,
    onImageClick,
    onQuoteReply,
    onReactionToggle
}: MessageBubbleProps) {
    const [showQuoted, setShowQuoted] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const { user } = useAuth();

    const isMe = message.senderType === 'AGENT';
    const isSystem = message.senderType === 'SYSTEM';

    const { subject, body } = useMemo(() => parseEmailContent(message.content), [message.content]);
    const { mainContent, quotedContent } = useMemo(() => parseQuotedContent(body), [body]);
    const attachments = useMemo(() => extractAttachments(body), [body]);
    const isHtmlContent = useMemo(() => /<[a-z][\s\S]*>/i.test(mainContent), [mainContent]);

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

    const handleContentClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'IMG' && onImageClick) {
            e.preventDefault();
            onImageClick((target as HTMLImageElement).src);
        }
    };

    // System messages - centered pill
    if (isSystem) {
        return (
            <div className="flex justify-center my-4">
                <span className="text-gray-500 text-xs italic bg-gray-100 px-4 py-1.5 rounded-full">
                    {message.content}
                </span>
            </div>
        );
    }

    const senderName = isMe ? (user?.fullName || 'You') : (recipientName || 'Customer');
    const senderInitial = senderName.charAt(0).toUpperCase();

    return (
        <div
            className={cn(
                "mb-1 transition-colors",
                isHovered && "bg-blue-50/50"
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Email Card */}
            <div className={cn(
                "bg-white border border-gray-200 rounded-lg overflow-hidden",
                message.isInternal && "bg-amber-50 border-amber-200"
            )}>
                {/* Email Header - Sender info */}
                <div className={cn(
                    "px-4 py-3 border-b flex items-start gap-3",
                    message.isInternal ? "border-amber-200 bg-amber-50" : "border-gray-100 bg-gray-50"
                )}>
                    {/* Avatar */}
                    <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0",
                        isMe ? "bg-blue-600" : "bg-gray-500",
                        message.isInternal && "bg-amber-600"
                    )}>
                        {senderInitial}
                    </div>

                    {/* Sender details */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-gray-900">{senderName}</span>
                            {isMe && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-sm">
                                    <Send size={10} />
                                    Sent
                                </span>
                            )}
                            {!isMe && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-sm">
                                    <CornerDownRight size={10} />
                                    Received
                                </span>
                            )}
                            {message.isInternal && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-200 text-amber-800 text-xs font-medium rounded-sm">
                                    🔒 Private Note
                                </span>
                            )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                            {format(new Date(message.createdAt), 'EEEE, MMMM d, yyyy \'at\' h:mm a')}
                        </div>
                    </div>

                    {/* Status & Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                        {isMe && !message.isInternal && (
                            <span className="flex items-center gap-1 text-xs text-gray-400" title={message.status === 'FAILED' ? 'Failed to send' : 'Sent'}>
                                {message.status === 'FAILED' ? (
                                    <>
                                        <AlertCircle size={14} className="text-red-500" />
                                        <span className="text-red-500">Failed</span>
                                    </>
                                ) : (
                                    <>
                                        <Check size={14} className="text-green-500" />
                                        <span className="text-green-600">Delivered</span>
                                    </>
                                )}
                            </span>
                        )}
                        {isHovered && onQuoteReply && (
                            <button
                                onClick={() => onQuoteReply(message)}
                                className="p-1.5 rounded-sm hover:bg-gray-200 text-gray-500 transition-colors"
                                title="Reply"
                            >
                                <Reply size={16} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Subject line (if present) */}
                {subject && (
                    <div className="px-4 py-2 border-b border-gray-100 bg-white">
                        <div className="text-sm font-medium text-gray-900">
                            Subject: {subject}
                        </div>
                    </div>
                )}

                {/* Email Body */}
                <div className="px-4 py-4 bg-white">
                    <div
                        className={cn(
                            "text-sm text-gray-800 leading-relaxed",
                            !isHtmlContent && "whitespace-pre-wrap",
                            isHtmlContent && "email-body-content [&_table]:max-w-full [&_img]:max-w-full [&_img]:h-auto [&_img]:cursor-pointer [&_a]:text-blue-600 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-gray-600"
                        )}
                        onClick={handleContentClick}
                        dangerouslySetInnerHTML={{ __html: sanitizedContent }}
                    />

                    {/* Quoted content (collapsible) */}
                    {quotedContent && (
                        <div className="mt-4 pt-3 border-t border-gray-200">
                            <button
                                onClick={() => setShowQuoted(!showQuoted)}
                                className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                            >
                                {showQuoted ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                <span className="font-medium">
                                    {showQuoted ? 'Hide quoted text' : 'Show quoted text'}
                                </span>
                            </button>
                            {showQuoted && sanitizedQuotedContent && (
                                <div
                                    className="mt-3 pl-4 border-l-2 border-gray-300 text-sm text-gray-600 italic"
                                    dangerouslySetInnerHTML={{ __html: sanitizedQuotedContent }}
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Attachments (if any) */}
                {attachments.length > 0 && (
                    <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
                        <div className="text-xs font-medium text-gray-600 mb-2">
                            Attachments ({attachments.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {attachments.map((attachment, idx) => (
                                <a
                                    key={idx}
                                    href={attachment.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors"
                                >
                                    <AttachmentIcon type={attachment.type} />
                                    <span className="text-xs text-gray-700 max-w-[150px] truncate">{attachment.filename}</span>
                                    <Download size={12} className="text-gray-400" />
                                </a>
                            ))}
                        </div>
                    </div>
                )}

                {/* Reactions (if any) */}
                {message.reactions && Object.keys(message.reactions).length > 0 && (
                    <div className="px-4 py-2 border-t border-gray-100 bg-white flex flex-wrap gap-1">
                        {Object.entries(message.reactions).map(([emoji, users]) => (
                            <button
                                key={emoji}
                                onClick={() => onReactionToggle?.(message.id, emoji)}
                                className={cn(
                                    "inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm transition-colors border",
                                    users.some(u => u.userId === user?.id)
                                        ? "bg-blue-50 border-blue-200 text-blue-700"
                                        : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                                )}
                                title={users.map(u => u.userName || 'Unknown').join(', ')}
                            >
                                <span>{emoji}</span>
                                {users.length > 1 && <span className="text-xs">{users.length}</span>}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});
