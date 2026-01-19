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
import { useState, useMemo, memo } from 'react';
import DOMPurify from 'dompurify';
import { format } from 'date-fns';
import { cn } from '../../utils/cn';
import { Check, AlertCircle, ChevronDown, ChevronUp, FileText, Download, Image as ImageIcon, File, Reply, Eye, Paperclip } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { GravatarAvatar } from './GravatarAvatar';
import { escapeRegex } from '../../utils/string';

interface QuotedContentInfo {
    mainContent: string;
    quotedContent: string | null;
    quotedPreview: string | null;
    quotedLineCount: number;
    quotedAttachmentCount: number;
}

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
 * Cleans up raw email metadata and MIME header fragments from content.
 * Email replies often contain leaked header fragments like:
 * - "v="Content-Type" content="text/html; charset=Windows-1252">"
 * - "-html40">" (partial HTML doctype/meta tag fragments)
 * - CSS style fragments: "t-size: 12pt; color: rgb(0, 0, 0);">"
 * - Raw MIME boundaries and headers
 * 
 * IMPORTANT: Patterns must be targeted to avoid stripping actual content.
 * Use ^ anchors for line-start patterns or require specific orphaned formats.
 */
function cleanEmailMetadata(content: string): string {
    let cleaned = content;

    // Remove CSS style attribute fragments ONLY at line start (orphaned from stripped tags)
    // Matches lines starting with: t-size: 12pt; color: rgb(0, 0, 0);">
    cleaned = cleaned.replace(/^[a-z-]*size:\s*\d+pt;[^>\n]*">\s*/gim, '');
    cleaned = cleaned.replace(/^[a-z-]*color:\s*rgb\([^)]+\);?[^>\n]*">\s*/gim, '');

    // Remove lines that are just orphaned style attributes ending with ">
    // Must start with partial CSS and end with "> to be considered orphaned
    cleaned = cleaned.replace(/^[a-z-]+:\s*[^;]{1,50};\s*">\s*/gim, '');

    // Remove partial HTML tag fragments like "-html40">" at line start
    cleaned = cleaned.replace(/^-?html\d*["']?\s*>\s*/gim, '');

    // Remove standalone closing angle brackets with charset (at line start)
    cleaned = cleaned.replace(/^[^<\n]{0,60}charset[^>]*>\s*/gim, '');

    // Remove broken HTML meta tag fragments (attribute leakage from stripped tags)
    cleaned = cleaned.replace(/[a-z-]+=["'][^"']*["']\s*[a-z-]*=["'][^"']*charset[^"']*["'][^>]*>/gi, '');

    // Remove standalone Content-Type declarations (at line start)
    cleaned = cleaned.replace(/^Content-Type[:\s]+[^\n<]+$/gim, '');

    // Remove MIME boundary markers
    cleaned = cleaned.replace(/--[a-zA-Z0-9_-]+--?/g, '');

    // Remove charset declarations at line start
    cleaned = cleaned.replace(/^charset\s*=\s*["']?[^"'\s>]+["']?\s*/gim, '');

    // Remove X-headers from email (X-Mailer, X-Priority, etc.)
    cleaned = cleaned.replace(/^X-[A-Za-z-]+:.*$/gim, '');

    // Remove MIME-Version headers
    cleaned = cleaned.replace(/^MIME-Version:.*$/gim, '');

    // Clean up lines that are ONLY attribute fragments (nothing else on the line)
    cleaned = cleaned.replace(/^[a-z-]+=["'][^"']*["']>?\s*$/gim, '');

    // Remove orphaned closing angle brackets at start of lines
    cleaned = cleaned.replace(/^["']?\s*>\s*$/gm, '');

    // Remove email quote markers on their own lines: < <, <<, >>, > >
    cleaned = cleaned.replace(/^[<>]\s*[<>]\s*$/gm, '');

    return cleaned.trim();
}

/**
 * Strips HTML tags and returns plain text for analysis.
 */
function stripHtmlForAnalysis(html: string): string {
    // First clean email metadata
    let cleaned = cleanEmailMetadata(html);

    return cleaned
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n') // Collapse excessive newlines
        .trim();
}

/**
 * Extracts a preview snippet from quoted content (first meaningful line or two).
 */
function extractQuotedPreview(quotedContent: string): string {
    const text = stripHtmlForAnalysis(quotedContent);
    const lines = text.split('\n').filter(line => {
        const trimmed = line.trim();
        // Skip empty lines, quote markers, and metadata headers
        if (!trimmed) return false;
        if (trimmed.startsWith('>')) return false;
        if (/^(On|From|Sent|To|Subject|Date):/i.test(trimmed)) return false;
        if (/wrote:$/i.test(trimmed)) return false;
        if (/^-{3,}/.test(trimmed) || /^_{3,}/.test(trimmed)) return false;
        return true;
    });

    // Get first meaningful line, truncated if needed
    const preview = lines[0] || '';
    return preview.length > 80 ? preview.slice(0, 77) + '...' : preview;
}

/**
 * Counts meaningful lines in quoted content.
 */
function countQuotedLines(quotedContent: string): number {
    const text = stripHtmlForAnalysis(quotedContent);
    return text.split('\n').filter(line => line.trim().length > 0).length;
}

/**
 * Counts attachments referenced in quoted content.
 */
function countQuotedAttachments(quotedContent: string): number {
    const imgMatches = quotedContent.match(/<img[^>]+>/gi) || [];
    const attachmentMatches = quotedContent.match(/<\d+.*?\.pdf>|<\d+.*?\.docx?>|<\d+.*?\.xlsx?>/gi) || [];
    return imgMatches.length + attachmentMatches.length;
}

/**
 * Detects and separates quoted email content from the main message.
 * Handles various email clients: Gmail, Outlook, Apple Mail, etc.
 */
function parseQuotedContent(body: string): QuotedContentInfo {
    // First, try to find HTML-based quote markers (Gmail blockquote, etc.)
    const htmlQuotePatterns = [
        // Gmail-style blockquote
        /<blockquote[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>/i,
        // Generic blockquote with cite
        /<blockquote[^>]*type="cite"[^>]*>/i,
        // Outlook-style divider
        /<div[^>]*style="[^"]*border-top[^"]*"[^>]*>/i,
        // Apple Mail quote wrapper
        /<div[^>]*class="[^"]*AppleOriginalContents[^"]*"[^>]*>/i,
    ];

    const buildResult = (main: string, quoted: string | null): QuotedContentInfo => ({
        mainContent: main,
        quotedContent: quoted,
        quotedPreview: quoted ? extractQuotedPreview(quoted) : null,
        quotedLineCount: quoted ? countQuotedLines(quoted) : 0,
        quotedAttachmentCount: quoted ? countQuotedAttachments(quoted) : 0,
    });

    for (const pattern of htmlQuotePatterns) {
        const match = body.match(pattern);
        if (match && match.index !== undefined && match.index > 50) {
            return buildResult(
                body.slice(0, match.index).trim(),
                body.slice(match.index).trim()
            );
        }
    }

    // Strip HTML for text-based pattern matching
    const textBody = stripHtmlForAnalysis(body);

    // Patterns that typically start quoted content
    const quoteStartPatterns = [
        // iOS/Apple Mail: "On Jan 15, 2026, at 8:52 am, Name <email> wrote:"
        /On .+,\s*(at\s+)?\d{1,2}[:.]\d{2}\s*(am|pm)?,?\s*.+\s*wrote:/im,
        // Standard: "On Mon, Jan 15, 2026 at 8:52 AM Name <email> wrote:"
        /On .+ wrote:$/m,
        // Outlook style headers block
        /From:\s*.+\n\s*Sent:\s*.+\n\s*To:/im,
        // Outlook: "From: Name" followed by metadata
        /^From:\s*.+<.+@.+>/m,
        // Original Message dividers
        /-{2,}\s*Original Message\s*-{2,}/im,
        /-{2,}\s*Forwarded message\s*-{2,}/im,
        // Separator lines
        /^_{5,}$/m,
        /^-{5,}$/m,
        // CAUTION/Warning banners (often precede forwarded content)
        /CAUTION:\s*This email originated from outside/i,
        // Subject line in reply (often indicates quoted content)
        /^Subject:\s*.+$/m,
    ];

    let splitIndex = -1;
    let matchedInTextBody = false;

    for (const pattern of quoteStartPatterns) {
        const match = textBody.match(pattern);
        if (match && match.index !== undefined && match.index > 20) {
            if (splitIndex === -1 || match.index < splitIndex) {
                splitIndex = match.index;
                matchedInTextBody = true;
            }
        }
    }

    // Also check for consecutive ">" quoted lines
    const lines = textBody.split('\n');
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
                    matchedInTextBody = true;
                }
            }
            consecutiveQuotedLines = 0;
            firstQuoteIndex = -1;
        }
    }

    if (splitIndex > 0) {
        if (matchedInTextBody) {
            const textBeforeQuote = textBody.slice(0, splitIndex).trim();
            const lastWords = textBeforeQuote.split(/\s+/).slice(-5).join('\\s*');
            if (lastWords.length > 10) {
                try {
                    const htmlSearchPattern = new RegExp(escapeRegex(lastWords), 'i');
                    const htmlMatch = body.match(htmlSearchPattern);
                    if (htmlMatch && htmlMatch.index !== undefined) {
                        const htmlSplitIndex = htmlMatch.index + htmlMatch[0].length;
                        const afterMatch = body.slice(htmlSplitIndex);
                        const nextBreak = afterMatch.match(/^[^<]*(<|$)/);
                        const adjustedSplit = htmlSplitIndex + (nextBreak ? nextBreak[0].length - 1 : 0);
                        return buildResult(
                            body.slice(0, adjustedSplit).trim(),
                            body.slice(adjustedSplit).trim()
                        );
                    }
                } catch {
                    // If regex construction fails, fall through to simple split
                }
            }
        }

        return buildResult(
            body.slice(0, splitIndex).trim(),
            body.slice(splitIndex).trim()
        );
    }

    return buildResult(body, null);
}

interface AttachmentInfo {
    type: 'image' | 'pdf' | 'document' | 'file';
    url: string;
    filename: string;
    isInline?: boolean;
}

/**
 * Extracts attachment info from message content.
 * Handles inline images, linked files, markdown links, and email attachment references.
 */
function extractAttachments(content: string): AttachmentInfo[] {
    const attachments: AttachmentInfo[] = [];
    const seenUrls = new Set<string>();

    // Extract inline images
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(content)) !== null) {
        const url = match[1];
        if (!seenUrls.has(url)) {
            seenUrls.add(url);
            const filename = url.split('/').pop() || 'image';
            attachments.push({ type: 'image', url, filename, isInline: true });
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
            attachments.push({ type: 'pdf', url, filename: text || url.split('/').pop() || 'document.pdf' });
        } else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
            seenUrls.add(url);
            attachments.push({ type: 'document', url, filename: text || url.split('/').pop() || 'document' });
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            seenUrls.add(url);
            attachments.push({ type: 'image', url, filename: text || url.split('/').pop() || 'image' });
        }
    }

    // Extract markdown-style links: [filename](url)
    // Matches: [55466 - Yvonne McKay.pdf](/uploads/attachments/...)
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/gi;
    while ((match = markdownLinkRegex.exec(content)) !== null) {
        const text = match[1];
        const url = match[2];
        if (seenUrls.has(url)) continue;

        // Get extension from either URL or link text (filename)
        const urlExt = url.split('.').pop()?.toLowerCase().split(/[?#]/)[0] || '';
        const textExt = text.split('.').pop()?.toLowerCase() || '';
        const ext = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt', 'csv', 'zip'].includes(urlExt) ? urlExt : textExt;

        // Check if it's an attachment URL (by path OR by having attachment-like extension)
        const isAttachmentUrl = url.includes('/uploads/attachments/') ||
            url.includes('/uploads/') ||
            url.includes('/attachment') ||
            ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt', 'csv', 'zip'].includes(ext);

        if (isAttachmentUrl && ext) {
            seenUrls.add(url);

            let type: AttachmentInfo['type'] = 'file';
            if (ext === 'pdf') type = 'pdf';
            else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) type = 'document';
            else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) type = 'image';

            attachments.push({ type, url, filename: text || url.split('/').pop() || 'file' });
        }
    }

    // Extract email attachment references like "<55340 - Jules Denslow.pdf>"
    const emailAttachmentRegex = /<([^>]+\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp))>/gi;
    while ((match = emailAttachmentRegex.exec(content)) !== null) {
        const filename = match[1].trim();
        const ext = match[2].toLowerCase();

        let type: AttachmentInfo['type'] = 'file';
        if (ext === 'pdf') type = 'pdf';
        else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) type = 'document';
        else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) type = 'image';

        if (!attachments.some(a => a.filename === filename)) {
            attachments.push({ type, url: '', filename });
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
    recipientEmail,
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
    const { mainContent, quotedContent, quotedPreview, quotedLineCount, quotedAttachmentCount } = useMemo(() => parseQuotedContent(body), [body]);
    const attachments = useMemo(() => extractAttachments(mainContent), [mainContent]); // Only from main content, not quoted
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
            ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'width', 'height', 'style', 'class'],
            ALLOW_DATA_ATTR: false,
        });
    }, [mainContent]);

    const sanitizedQuotedContent = useMemo(() => {
        if (!quotedContent) return null;
        // Clean email metadata from quoted content as well
        const cleanedQuoted = cleanEmailMetadata(quotedContent);
        return DOMPurify.sanitize(cleanedQuoted, {
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

    return (
        <div
            className={cn(
                "mb-3 transition-colors group",
                isMe ? "flex justify-end" : "flex justify-start"
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
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
                        message.isInternal && "bg-amber-50 border border-amber-200 text-gray-900 shadow-none"
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
                                "text-sm leading-relaxed",
                                !isHtmlContent && "whitespace-pre-wrap",
                                isHtmlContent && cn(
                                    "[&_table]:max-w-full [&_img]:max-w-full [&_img]:h-auto [&_img]:cursor-pointer",
                                    "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:opacity-80",
                                    isMe
                                        ? "[&_a]:text-blue-100 [&_a]:underline [&_blockquote]:border-blue-400"
                                        : "[&_a]:text-blue-600 [&_a]:underline [&_blockquote]:border-gray-400"
                                )
                            )}
                            onClick={handleContentClick}
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
                                            "mt-2 pl-3 border-l-2 text-xs opacity-80 max-h-96 overflow-y-auto",
                                            isMe ? "border-blue-400" : "border-gray-300"
                                        )}
                                        dangerouslySetInnerHTML={{ __html: sanitizedQuotedContent }}
                                    />
                                )}
                            </div>
                        )}
                    </div>

                    {/* Attachments as compact pills */}
                    {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                            {attachments.map((attachment, idx) => (
                                attachment.type === 'image' && attachment.url ? (
                                    // Image thumbnail pill
                                    <button
                                        key={idx}
                                        onClick={() => onImageClick?.(attachment.url)}
                                        className="group flex items-center gap-2 pl-1 pr-3 py-1 bg-gradient-to-r from-gray-50 to-white border border-gray-200 rounded-full shadow-sm hover:shadow hover:border-gray-300 transition-all"
                                    >
                                        <img
                                            src={attachment.url}
                                            alt={attachment.filename}
                                            className="w-6 h-6 object-cover rounded-full ring-1 ring-gray-200"
                                        />
                                        <span className="text-xs text-gray-600 max-w-[100px] truncate group-hover:text-gray-900">
                                            {attachment.filename}
                                        </span>
                                        <Eye size={12} className="text-gray-400 group-hover:text-blue-500 transition-colors" />
                                    </button>
                                ) : (
                                    // File attachment pill
                                    <a
                                        key={idx}
                                        href={attachment.url || '#'}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        download={attachment.filename}
                                        className={cn(
                                            "group inline-flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm transition-all",
                                            attachment.type === 'pdf'
                                                ? "bg-gradient-to-r from-red-50 to-white border border-red-200 hover:border-red-300 hover:shadow"
                                                : attachment.type === 'document'
                                                    ? "bg-gradient-to-r from-blue-50 to-white border border-blue-200 hover:border-blue-300 hover:shadow"
                                                    : "bg-gradient-to-r from-gray-50 to-white border border-gray-200 hover:border-gray-300 hover:shadow",
                                            !attachment.url && "opacity-60 pointer-events-none"
                                        )}
                                    >
                                        <span className={cn(
                                            "p-1 rounded-full",
                                            attachment.type === 'pdf' ? "bg-red-100" : attachment.type === 'document' ? "bg-blue-100" : "bg-gray-100"
                                        )}>
                                            <AttachmentIcon type={attachment.type} />
                                        </span>
                                        <span className="text-xs text-gray-700 max-w-[120px] truncate font-medium group-hover:text-gray-900">
                                            {attachment.filename}
                                        </span>
                                        {attachment.url ? (
                                            <Download size={12} className="text-gray-400 group-hover:text-green-500 transition-colors" />
                                        ) : (
                                            <Paperclip size={12} className="text-gray-400" />
                                        )}
                                    </a>
                                )
                            ))}
                        </div>
                    )}

                    {/* Timestamp and status row */}
                    <div className={cn(
                        "flex items-center gap-2 mt-1 text-xs text-gray-500",
                        isMe ? "justify-end" : "justify-start"
                    )}>
                        <span>{format(new Date(message.createdAt), 'h:mm a')}</span>

                        {/* Status indicators for sent messages */}
                        {isMe && !message.isInternal && (
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
                        {isHovered && onQuoteReply && (
                            <button
                                onClick={() => onQuoteReply(message)}
                                className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                                title="Reply"
                            >
                                <Reply size={12} />
                            </button>
                        )}
                    </div>

                    {/* Reactions (if any) */}
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
