/**
 * MessageBubble - Renders a single message in the inbox.
 * Redesigned to display emails in a traditional email reader format (like Gmail/Outlook)
 * rather than chat bubbles. Shows sender header, date, and clean body layout.
 * 
 * Features:
 * - Collapsible quoted content with preview snippet
 * - Line count indicator for hidden content
 * - Smart attachment handling with image thumbnails
 * - Email signature detection
 */
import { useState, useMemo, useRef, memo } from 'react';
import DOMPurify from 'dompurify';
import { format } from 'date-fns';
import { cn } from '../../utils/cn';
import { Check, AlertCircle, ChevronDown, ChevronUp, Reply, Eye } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { GravatarAvatar } from './GravatarAvatar';
import { parseEmailContent, parseQuotedContent, cleanEmailMetadata } from '../../utils/emailParser';
import { AttachmentGallery } from './AttachmentDisplay';

interface MessageBubbleProps {
    message: {
        id: string;
        content: string;
        senderType: 'AGENT' | 'CUSTOMER' | 'SYSTEM';
        createdAt: string;
        isInternal: boolean;
        senderId?: string;
        readAt?: string | null;
        status?: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'PENDING';
        reactions?: Record<string, Array<{ userId: string; userName: string | null }>>;
        pendingUndo?: boolean;
        remainingSeconds?: number;
        // Email tracking fields
        trackingId?: string | null;
        firstOpenedAt?: string | null;
        openCount?: number;
    };
    recipientName?: string;
    recipientEmail?: string;
    onImageClick?: (src: string) => void;
    onQuoteReply?: (message: { id: string; content: string; senderType: string }) => void;
    onReactionToggle?: (messageId: string, emoji: string) => Promise<void>;
    onUndoPending?: () => void;
}

/**
 * MessageBubble component - Traditional email reader format
 */
export const MessageBubble = memo(function MessageBubble({
    message,
    recipientName,
    recipientEmail,
    onImageClick,
    onQuoteReply,
    onReactionToggle,
    onUndoPending
}: MessageBubbleProps) {
    const [showQuoted, setShowQuoted] = useState(false);
    const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
    const { user } = useAuth();

    const isMe = message.senderType === 'AGENT';
    const isSystem = message.senderType === 'SYSTEM';
    const isPendingUndo = Boolean(message.pendingUndo);

    const { subject, body } = useMemo(() => parseEmailContent(message.content), [message.content]);
    const { mainContent, quotedContent, quotedPreview, quotedLineCount, quotedAttachmentCount } = useMemo(() => parseQuotedContent(body), [body]);
    const attachments = useMemo(() => {
        // Extract from full body to catch attachments after quoted markers
        const content = body;
        const attachmentsList: Array<{ type: 'image' | 'pdf' | 'document' | 'file'; url: string; filename: string; isInline?: boolean }> = [];
        const seenUrls = new Set<string>();

        // Extract inline images
        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = imgRegex.exec(content)) !== null) {
            const url = match[1];
            if (!seenUrls.has(url)) {
                seenUrls.add(url);
                const filename = url.split('/').pop() || 'image';
                attachmentsList.push({ type: 'image', url, filename, isInline: true });
            }
        }

        // Extract HTML linked files
        const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
        while ((match = linkRegex.exec(content)) !== null) {
            const url = match[1];
            const text = match[2];
            if (seenUrls.has(url)) continue;

            const ext = url.split('.').pop()?.toLowerCase() || '';

            if (['pdf'].includes(ext)) {
                seenUrls.add(url);
                attachmentsList.push({ type: 'pdf', url, filename: text || url.split('/').pop() || 'document.pdf' });
            } else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
                seenUrls.add(url);
                attachmentsList.push({ type: 'document', url, filename: text || url.split('/').pop() || 'document' });
            } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                seenUrls.add(url);
                attachmentsList.push({ type: 'image', url, filename: text || url.split('/').pop() || 'image' });
            }
        }

        // Extract markdown-style links: [filename](url)
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/gi;
        while ((match = markdownLinkRegex.exec(content)) !== null) {
            const text = match[1];
            const url = match[2];
            if (seenUrls.has(url)) continue;

            const urlExt = url.split('.').pop()?.toLowerCase().split(/[?#]/)[0] || '';
            const textExt = text.split('.').pop()?.toLowerCase() || '';

            const validExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt', 'csv', 'zip'];
            const ext = validExtensions.includes(urlExt) ? urlExt : (validExtensions.includes(textExt) ? textExt : '');

            const isAttachmentPath = url.includes('/uploads/attachments/') ||
                url.includes('/attachment/') ||
                url.includes('/files/');
            const hasFileExtensionInText = validExtensions.some(e => text.toLowerCase().endsWith('.' + e));
            const isAttachment = ext && (isAttachmentPath || hasFileExtensionInText);

            if (isAttachment) {
                seenUrls.add(url);

                let type: 'image' | 'pdf' | 'document' | 'file' = 'file';
                if (ext === 'pdf') type = 'pdf';
                else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) type = 'document';
                else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) type = 'image';

                const filename = text || url.split('/').pop() || 'file';
                const isSignatureLikeFilename = (name: string) => /^(logo|signature|sig|banner|brand|header|footer|icon|avatar|divider|spacer|separator|bullet|pixel|tracker|tracking|beacon|dot|arrow)\d*[-_]?\w*\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
                if (type === 'image' && isSignatureLikeFilename(filename)) continue;

                attachmentsList.push({ type, url, filename });
            }
        }

        // Extract email attachment references like "<55340 - Jules Denslow.pdf>"
        const emailAttachmentRegex = /<([^>]+\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp))>/gi;
        while ((match = emailAttachmentRegex.exec(content)) !== null) {
            const filename = match[1].trim();
            const ext = match[2].toLowerCase();

            let type: 'image' | 'pdf' | 'document' | 'file' = 'file';
            if (ext === 'pdf') type = 'pdf';
            else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) type = 'document';
            else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) type = 'image';

            if (!attachmentsList.some(a => a.filename === filename)) {
                attachmentsList.push({ type, url: '', filename });
            }
        }

        return attachmentsList;
    }, [body]);
    const isHtmlContent = useMemo(() => /<[a-z][\s\S]*>/i.test(mainContent), [mainContent]);

    const sanitizedContent = useMemo(() => {
        // Clean up email metadata first (raw MIME headers, charset, etc.)
        // Then strip attachment markdown links before rendering
        // Remove patterns like: [filename](/uploads/attachments/...)
        // Also remove the "**Attachments:**" header and following lines if present
        let cleanContent = cleanEmailMetadata(mainContent);

        // Remove "**Attachments:**" header and the markdown links that follow
        cleanContent = cleanContent.replace(/\n\n\*\*Attachments:\*\*\n[\s\S]*$/i, '');
        cleanContent = cleanContent.replace(/\*\*Attachments:\*\*\s*\n?/gi, '');

        // Remove markdown attachment links: [filename](/uploads/...) or [filename.pdf](url)
        cleanContent = cleanContent.replace(/\[([^\]]+)\]\((\/uploads\/[^)]+)\)/gi, '');
        // Also remove markdown links that look like attachments (by extension in link text)
        cleanContent = cleanContent.replace(/\[([^\]]+\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|txt|csv|zip))\]\([^)]+\)/gi, '');

        // Remove "Attachments: " or "Attachments:\n" plain text prefix (handles both formats)
        cleanContent = cleanContent.replace(/Attachments:\s*/gi, '');

        // Trim trailing whitespace/newlines
        cleanContent = cleanContent.trim();

        return DOMPurify.sanitize(cleanContent, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'blockquote', 'div', 'span', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'width', 'height'],
            ALLOW_DATA_ATTR: false,
            ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|\/(?!\/))/i,
        });
    }, [mainContent]);

    const sanitizedQuotedContent = useMemo(() => {
        if (!quotedContent) return null;
        // Clean email metadata from quoted content as well
        const cleanedQuoted = cleanEmailMetadata(quotedContent);
        return DOMPurify.sanitize(cleanedQuoted, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'div', 'span'],
            ALLOWED_ATTR: ['href', 'target'],
            ALLOW_DATA_ATTR: false,
            ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|\/(?!\/))/i,
        });
    }, [quotedContent]);

    const handleContentPointerDown = (e: React.MouseEvent) => {
        pointerDownRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleContentPointerUp = (e: React.MouseEvent) => {
        const start = pointerDownRef.current;
        pointerDownRef.current = null;

        // Don't intercept when the user has selected text (allows highlight + copy)
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) return;

        // Ignore drag/release interactions used for text highlighting
        if (start) {
            const dx = Math.abs(e.clientX - start.x);
            const dy = Math.abs(e.clientY - start.y);
            const moved = dx + dy;
            if (moved > 6) return;
        }

        const target = e.target as HTMLElement;
        if (target.tagName === 'IMG' && onImageClick) {
            e.preventDefault();
            onImageClick((target as HTMLImageElement).src);
        }
    };

    // System messages - centered pill
    if (isSystem) {
        // Strip HTML so tags like <br> render as spaces, not raw text
        const cleanSystemContent = message.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        return (
            <div className="flex justify-center my-4">
                <span className="text-gray-500 text-xs italic bg-gray-100 px-4 py-1.5 rounded-full">
                    {cleanSystemContent}
                </span>
            </div>
        );
    }

    const senderName = isMe ? (user?.fullName || 'You') : (recipientName || 'Customer');

    return (
        <div
            className={cn(
                "mb-3 transition-colors group",
                isMe ? "flex justify-end" : "flex justify-start"
            )}
        >
            {/* Chat-style layout */}
            <div className={cn(
                "flex gap-2 max-w-[85%]",
                isMe ? "flex-row-reverse" : "flex-row"
            )}>
                {/* Avatar */}
                <GravatarAvatar
                    email={isMe ? undefined : recipientEmail}
                    name={senderName}
                    size="sm"
                    variant={message.isInternal ? 'amber' : (isMe ? 'blue' : 'gray')}
                    className="self-end"
                />

                {/* Message bubble */}
                <div className="flex flex-col">
                    {/* Internal note badge */}
                    {message.isInternal && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 mb-1 bg-amber-100 text-amber-800 text-xs font-medium rounded-sm w-fit">
                            🔒 Private Note
                        </span>
                    )}

                    {/* Bubble */}
                    <div className={cn(
                        "rounded-2xl px-4 py-2.5 relative shadow-sm",
                        isMe
                            ? "bg-blue-600 text-white rounded-br-md"
                            : "bg-white text-gray-900 rounded-bl-md border border-gray-200",
                        message.isInternal && "bg-amber-50 border border-amber-200 text-gray-900 shadow-none",
                        isPendingUndo && "bg-blue-600/85 border-2 border-dashed border-blue-400"
                    )}>
                        {/* Subject line (if present) */}
                        {subject && (
                            <div className={cn(
                                "text-xs font-semibold mb-1.5 pb-1.5 border-b",
                                isMe ? "border-blue-500/30" : "border-gray-200"
                            )}>
                                {subject}
                            </div>
                        )}

                        {/* Message content */}
                        <div
                            className={cn(
                                "text-sm leading-relaxed select-text",
                                !isHtmlContent && "whitespace-pre-wrap",
                                isHtmlContent && cn(
                                    "[&_table]:max-w-full [&_img]:max-w-full [&_img]:h-auto [&_img]:cursor-pointer",
                                    "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:opacity-80",
                                    isMe
                                        ? "[&_a]:text-blue-100 [&_a]:underline [&_blockquote]:border-blue-400"
                                        : "[&_a]:text-blue-600 [&_a]:underline [&_blockquote]:border-gray-400"
                                )
                            )}
                            onMouseDown={handleContentPointerDown}
                            onMouseUp={handleContentPointerUp}
                            dangerouslySetInnerHTML={{ __html: sanitizedContent }}
                        />

                        {/* Quoted content (collapsible) */}
                        {quotedContent && (
                            <div className={cn(
                                "mt-3 pt-2 border-t",
                                isMe ? "border-blue-500/30" : "border-gray-200"
                            )}>
                                <button
                                    onClick={() => setShowQuoted(!showQuoted)}
                                    className={cn(
                                        "flex flex-col items-start gap-1 text-xs w-full text-left px-2 py-1.5 rounded transition-colors",
                                        isMe
                                            ? "text-blue-200 hover:text-white hover:bg-blue-500/30"
                                            : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"
                                    )}
                                >
                                    <div className="flex items-center gap-1.5 font-medium">
                                        {showQuoted ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        <span>{showQuoted ? 'View less' : 'View more'}</span>
                                        <span className="text-[10px] opacity-70 font-normal">
                                            • {quotedLineCount} lines
                                            {quotedAttachmentCount > 0 && ` • ${quotedAttachmentCount} attachment${quotedAttachmentCount > 1 ? 's' : ''}`}
                                        </span>
                                    </div>
                                    {!showQuoted && quotedPreview && (
                                        <div className={cn(
                                            "text-[11px] pl-5 opacity-60 italic truncate max-w-full",
                                            isMe ? "text-blue-100" : "text-gray-600"
                                        )}>
                                            "{quotedPreview}"
                                        </div>
                                    )}
                                </button>
                                {showQuoted && sanitizedQuotedContent && (
                                    <div
                                        className={cn(
                                            "mt-2 pl-3 border-l-2 text-xs opacity-80 max-h-96 overflow-y-auto select-text",
                                            isMe ? "border-blue-400" : "border-gray-300"
                                        )}
                                        dangerouslySetInnerHTML={{ __html: sanitizedQuotedContent }}
                                    />
                                )}
                            </div>
                        )}
                    </div>

                    {/* Attachments as compact pills */}
                    <AttachmentGallery attachments={attachments} onImageClick={onImageClick} />

                    {/* Timestamp and status row */}
                    <div className={cn(
                        "flex items-center gap-2 mt-1 text-xs text-gray-500",
                        isMe ? "justify-end" : "justify-start"
                    )}>
                        <span>{format(new Date(message.createdAt), 'MMM d · h:mm a')}</span>

                        {isPendingUndo && (
                            <>
                                <span className="text-blue-600 font-medium">
                                    Sending in {message.remainingSeconds ?? 0}s...
                                </span>
                                {onUndoPending && (
                                    <button
                                        onClick={onUndoPending}
                                        className="px-2 py-0.5 rounded-full bg-blue-100 hover:bg-blue-200 text-blue-700 transition-colors font-semibold"
                                    >
                                        Undo
                                    </button>
                                )}
                            </>
                        )}

                        {/* Status indicators for sent messages */}
                        {isMe && !message.isInternal && !isPendingUndo && (
                            <span className="flex items-center gap-0.5">
                                {message.status === 'FAILED' ? (
                                    <AlertCircle size={12} className="text-red-500" />
                                ) : message.firstOpenedAt ? (
                                    <Eye size={12} className="text-purple-500" />
                                ) : (
                                    <Check size={12} className="text-green-500" />
                                )}
                            </span>
                        )}

                        {/* Reply button on hover */}
                        {onQuoteReply && !isPendingUndo && (
                            <button
                                onClick={() => onQuoteReply(message)}
                                className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-all opacity-0 group-hover:opacity-100"
                                title="Reply"
                            >
                                <Reply size={12} />
                            </button>
                        )}
                    </div>

                                    {/* Reactions (if present) */}
                    {message.reactions && Object.keys(message.reactions).length > 0 && (
                        <div className={cn(
                            "flex flex-wrap gap-1 mt-1",
                            isMe ? "justify-end" : "justify-start"
                        )}>
                            {Object.entries(message.reactions).map(([emoji, users]) => (
                                <button
                                    key={emoji}
                                    onClick={() => onReactionToggle?.(message.id, emoji)}
                                    className={cn(
                                        "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs transition-colors border",
                                        users.some(u => u.userId === user?.id)
                                            ? "bg-blue-50 border-blue-200 text-blue-700"
                                            : "bg-white border-gray-200 hover:bg-gray-50"
                                    )}
                                    title={users.map(u => u.userName || 'Unknown').join(', ')}
                                >
                                    <span>{emoji}</span>
                                    {users.length > 1 && <span>{users.length}</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});
