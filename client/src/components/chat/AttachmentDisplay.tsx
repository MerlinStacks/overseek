/**
 * AttachmentDisplay - Renders file attachments with appropriate icons and thumbnails.
 * Extracted from MessageBubble.tsx for reusability.
 */
import { FileText, Download, Image as ImageIcon, File, Eye, Paperclip } from 'lucide-react';
import { cn } from '../../utils/cn';
import { getSafeHref } from '../../utils/url';
import { useState } from 'react';

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
/**
 * Icon component for rendering appropriate file type icons.
 */
function AttachmentIcon({ type }: { type: 'image' | 'pdf' | 'document' | 'file' }) {
    switch (type) {
        case 'image':
            return <ImageIcon size={16} />;
        case 'pdf':
            return <FileText size={16} className="text-red-500" />;
        case 'document':
            return <FileText size={16} className="text-[var(--brand-text)]" />;
        default:
            return <File size={16} />;
    }
}

interface AttachmentGalleryProps {
    attachments: AttachmentInfo[];
    onImageClick?: (src: string) => void;
}

/**
 * Renders a gallery of file attachments as compact pills.
 */
export function AttachmentGallery({ attachments, onImageClick }: AttachmentGalleryProps) {
    const [failedPreviews, setFailedPreviews] = useState<Set<string>>(() => new Set());
    // Inline images are already rendered in the message HTML body — skip them here.
    const visibleAttachments = attachments.filter(a => !a.isInline);

    if (visibleAttachments.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2 mt-2">
            {visibleAttachments.map((attachment, idx) => (
                attachment.type === 'image' && attachment.url && !failedPreviews.has(attachment.url) ? (
                    // Image thumbnail pill
                    <button
                        key={idx}
                        onClick={() => onImageClick?.(attachment.url)}
                        className="group flex items-center gap-2 pl-1 pr-3 py-1 bg-gray-50   border border-gray-200 rounded-full shadow-sm hover:shadow hover:border-gray-300 transition-all"
                    >
                        <img
                            src={attachment.url}
                            alt={attachment.filename}
                            className="w-6 h-6 object-cover rounded-full ring-1 ring-gray-200"
                            onError={() => setFailedPreviews(previous => new Set(previous).add(attachment.url))}
                        />
                        <span className="text-xs text-gray-600 max-w-[100px] truncate group-hover:text-gray-900">
                            {attachment.filename}
                        </span>
                        <Eye size={12} className="text-gray-400 group-hover:text-[var(--brand-text)] transition-colors" />
                    </button>
                ) : (
                    // File attachment pill
                    <a
                        key={idx}
                        href={getSafeHref(attachment.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={attachment.filename}
                        className={cn(
                            "group inline-flex items-center gap-2 px-3 py-1.5 rounded-full shadow-sm transition-all",
                            attachment.type === 'pdf'
                                ? "bg-red-50   border border-red-200 hover:border-red-300 hover:shadow"
                                : attachment.type === 'document'
                                    ? "bg-[var(--brand-subtle)] border border-[var(--brand-border)] hover:border-[var(--brand-border)] hover:shadow"
                                    : "bg-gray-50   border border-gray-200 hover:border-gray-300 hover:shadow",
                            !attachment.url && "opacity-60 pointer-events-none"
                        )}
                    >
                        <span className={cn(
                            "p-1 rounded-full",
                            attachment.type === 'pdf' ? "bg-red-100" : attachment.type === 'document' ? "bg-[var(--brand-subtle)]" : "bg-gray-100"
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
