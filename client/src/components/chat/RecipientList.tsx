/**
 * RecipientList Component
 * 
 * Displays multiple recipients for merged conversations with channel icons.
 * Shows the primary recipient prominently, with other channels collapsible.
 */

import { useState } from 'react';
import { Mail, MessageCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../utils/cn';

// Channel icon components (inline SVG for social platforms)
const InstagramIcon = () => (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
);

const FacebookIcon = () => (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
);

const TikTokIcon = () => (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
);

export interface MergedRecipient {
    id: string;
    channel: string;
    guestEmail?: string;
    guestName?: string;
    wooCustomer?: { email?: string; firstName?: string; lastName?: string };
    socialAccount?: { name?: string; platform?: string };
}

interface RecipientListProps {
    primaryEmail?: string;
    primaryName?: string;
    primaryChannel?: string;
    mergedRecipients?: MergedRecipient[];
    className?: string;
}

function getChannelIcon(channel: string) {
    switch (channel) {
        case 'EMAIL':
            return <Mail className="w-3.5 h-3.5" />;
        case 'CHAT':
            return <MessageCircle className="w-3.5 h-3.5" />;
        case 'INSTAGRAM':
            return <InstagramIcon />;
        case 'FACEBOOK':
            return <FacebookIcon />;
        case 'TIKTOK':
            return <TikTokIcon />;
        default:
            return <Mail className="w-3.5 h-3.5" />;
    }
}

function getChannelColor(channel: string) {
    switch (channel) {
        case 'EMAIL':
            return 'text-blue-600 bg-blue-50';
        case 'CHAT':
            return 'text-green-600 bg-green-50';
        case 'INSTAGRAM':
            return 'text-pink-600 bg-pink-50';
        case 'FACEBOOK':
            return 'text-indigo-600 bg-indigo-50';
        case 'TIKTOK':
            return 'text-gray-900 bg-gray-100';
        default:
            return 'text-gray-600 bg-gray-50';
    }
}

function getRecipientDisplay(recipient: MergedRecipient): string {
    if (recipient.socialAccount?.name) {
        return recipient.socialAccount.name;
    }
    if (recipient.wooCustomer?.email) {
        const name = `${recipient.wooCustomer.firstName || ''} ${recipient.wooCustomer.lastName || ''}`.trim();
        return name || recipient.wooCustomer.email;
    }
    return recipient.guestName || recipient.guestEmail || 'Unknown';
}

export function RecipientList({
    primaryEmail,
    primaryName,
    primaryChannel = 'EMAIL',
    mergedRecipients = [],
    className
}: RecipientListProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    // Build list of all unique recipients
    const allRecipients: Array<{ channel: string; display: string; identifier: string }> = [];

    // Add primary recipient
    if (primaryEmail || primaryName) {
        allRecipients.push({
            channel: primaryChannel,
            display: primaryName || primaryEmail || 'Customer',
            identifier: primaryEmail || primaryName || ''
        });
    }

    // Add merged recipients (avoid duplicates by email/identifier)
    const seenIdentifiers = new Set(allRecipients.map(r => r.identifier.toLowerCase()));

    for (const merged of mergedRecipients) {
        const display = getRecipientDisplay(merged);
        const identifier = merged.guestEmail || merged.wooCustomer?.email || merged.socialAccount?.name || display;

        if (!seenIdentifiers.has(identifier.toLowerCase())) {
            seenIdentifiers.add(identifier.toLowerCase());
            allRecipients.push({
                channel: merged.channel,
                display,
                identifier
            });
        }
    }

    // If only one recipient, show simple view
    if (allRecipients.length <= 1) {
        const recipient = allRecipients[0];
        return (
            <div className={cn("min-w-0", className)}>
                <div className="font-medium text-gray-900 text-sm truncate">
                    {recipient?.display || 'Customer'}
                </div>
                {primaryEmail && primaryName && (
                    <div className="text-xs text-gray-500 truncate">{primaryEmail}</div>
                )}
            </div>
        );
    }

    // Multiple recipients - show expandable list
    const visibleRecipients = isExpanded ? allRecipients : allRecipients.slice(0, 1);
    const hiddenCount = allRecipients.length - 1;

    return (
        <div className={cn("min-w-0", className)}>
            {/* Primary recipient */}
            <div className="flex items-center gap-1.5">
                <span className={cn("p-0.5 rounded", getChannelColor(allRecipients[0].channel))}>
                    {getChannelIcon(allRecipients[0].channel)}
                </span>
                <span className="font-medium text-gray-900 text-sm truncate">
                    {allRecipients[0].display}
                </span>
                {hiddenCount > 0 && (
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-700 font-medium shrink-0"
                    >
                        +{hiddenCount} more
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                )}
            </div>

            {/* Expanded recipients */}
            {isExpanded && (
                <div className="mt-1.5 space-y-1 pl-0.5">
                    {allRecipients.slice(1).map((recipient, index) => (
                        <div key={index} className="flex items-center gap-1.5 text-xs text-gray-600">
                            <span className={cn("p-0.5 rounded", getChannelColor(recipient.channel))}>
                                {getChannelIcon(recipient.channel)}
                            </span>
                            <span className="truncate">{recipient.display}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
