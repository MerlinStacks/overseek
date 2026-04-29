/**
 * AttachmentDisplay - Renders file attachments with appropriate icons and thumbnails.
 * Extracted from MessageBubble.tsx for reusability.
 */
/* eslint-disable react-refresh/only-export-components */
import { FileText, Download, Image as ImageIcon, File, Eye, Paperclip } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface AttachmentInfo {
    type: 'image' | 'pdf' | 'document' | 'file';
    url: string;
    filename: string;
    isInline?: boolean;
}

/** Returns true for filenames that look like signature/branding images rather than real attachments. */
function isSignatureLikeFilename(filename: string): boolean {
    return /^(logo|signature|sig|banner|brand|header|footer|icon|avatar|divider|spacer|separator|bullet|pixel|tracker|tracking|beacon|dot|arrow)\d*[-_]?\w*\.(png|jpe?g|gif|webp|bmp)$/i.test(filename);
}

/**
 * Extracts attachment info from message content.
 * Handles inline images, linked files, markdown links, and email attachment references.
 */
export function extractAttachments(content: string): AttachmentInfo[] {
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
        // Be careful to only extract extensions from actual file-like patterns
        const urlExt = url.split('.').pop()?.toLowerCase().split(/[?#]/)[0] || '';
        const textExt = text.split('.').pop()?.toLowerCase() || '';

        // Valid file extensions for attachments
        const validExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt', 'csv', 'zip'];
        const ext = validExtensions.includes(urlExt) ? urlExt : (validExtensions.includes(textExt) ? textExt : '');

        // Only count as attachment if:
        // 1. The URL looks like an attachment path (explicit attachment directories)
        // 2. AND has a valid file extension
        // This prevents random markdown links from being detected as attachments
        const isAttachmentPath = url.includes('/uploads/attachments/') ||
            url.includes('/attachment/') ||
            url.includes('/files/');

        // Only match if we have BOTH a valid extension AND an attachment-like path
        // OR if the link text itself looks like a filename with extension (e.g., "document.pdf")
        const hasFileExtensionInText = validExtensions.some(e => text.toLowerCase().endsWith('.' + e));
        const isAttachment = ext && (isAttachmentPath || hasFileExtensionInText);

        if (isAttachment) {
            seenUrls.add(url);

            let type: AttachmentInfo['type'] = 'file';
            if (ext === 'pdf') type = 'pdf';
            else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) type = 'document';
            else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) type = 'image';

            const filename = text || url.split('/').pop() || 'file';
            // Skip images that look like signature/branding content (server-side safety net)
            if (type === 'image' && isSignatureLikeFilename(filename)) continue;

            attachments.push({ type, url, filename });
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

/**
 * Icon component for rendering appropriate file type icons.
 */
export function AttachmentIcon({ type }: { type: 'image' | 'pdf' | 'document' | 'file' }) {
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

export interface AttachmentGalleryProps {
    attachments: AttachmentInfo[];
    onImageClick?: (src: string) => void;
}

/**
 * Renders a gallery of file attachments as compact pills.
 */
export function AttachmentGallery({ attachments, onImageClick }: AttachmentGalleryProps) {
    // Inline images are already rendered in the message HTML body — skip them here.
    const visibleAttachments = attachments.filter(a => !a.isInline);

    if (visibleAttachments.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2 mt-2">
            {visibleAttachments.map((attachment, idx) => (
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
    );
}
