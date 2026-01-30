/**
 * PreviousConversationsSection - Shows other conversations for a customer
 * 
 * Extracted from ContactPanel.tsx for improved modularity.
 * Displays previous conversations with status and preview.
 */

import { cn } from '../../utils/cn';
import { format } from 'date-fns';

interface PreviousConversation {
    id: string;
    status: string;
    updatedAt: string;
    channel: string;
    messages?: { content: string }[];
}

interface PreviousConversationsSectionProps {
    conversations: PreviousConversation[];
    onSelectConversation?: (conversationId: string) => void;
}

/**
 * Displays previous conversations for a customer.
 */
export function PreviousConversationsSection({
    conversations,
    onSelectConversation
}: PreviousConversationsSectionProps) {
    if (conversations.length === 0) {
        return (
            <div className="text-sm text-gray-500 italic">
                No previous conversations found.
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {conversations.slice(0, 5).map((conv) => {
                const preview = conv.messages?.[0]?.content?.replace(/<[^>]*>/g, '').slice(0, 60) || 'No messages';
                return (
                    <button
                        key={conv.id}
                        onClick={() => onSelectConversation?.(conv.id)}
                        className="w-full text-left p-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                    >
                        <div className="flex items-center justify-between">
                            <span className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase",
                                conv.status === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                            )}>
                                {conv.status}
                            </span>
                            <span className="text-[10px] text-gray-400">
                                {format(new Date(conv.updatedAt), 'MMM d')}
                            </span>
                        </div>
                        <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                            {preview}
                        </p>
                    </button>
                );
            })}
            {conversations.length > 5 && (
                <div className="text-xs text-gray-500 text-center pt-1">
                    +{conversations.length - 5} more
                </div>
            )}
        </div>
    );
}
